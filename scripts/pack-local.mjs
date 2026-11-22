import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const PRIVATE_README_MARKERS = [
  '项目总控',
  'AI-MANIFEST.yml',
  'AGENTS.md',
  'PROJECT-CHARTER.md',
  'GOVERNANCE.md',
  'tools/project-control.py',
]

export const FORBIDDEN_PACKAGE_ENTRIES = [
  'README.md',
  'AGENTS.md',
  'AI-MANIFEST.yml',
  'GOVERNANCE.md',
  'PROJECT-CHARTER.md',
  'STATUS.md',
  'ROADMAP.md',
  'ERRORS.md',
  'RESEARCH.md',
  'DESIGN.md',
  'DEVELOPMENT-PLAN.md',
  'ACCEPTANCE.md',
  'PUBLIC-RELEASE-MANIFEST.yml',
  'docs/',
  'qa/',
  'releases/',
  'tools/',
  'compatibility/',
  '.github/',
]

function unquoteYamlScalar(raw) {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Parse `public_export` list keys from `PUBLIC-RELEASE-MANIFEST.yml` without external YAML dependencies
 * so `scripts/pack-local.mjs` also runs in `.github/workflows/governance.yml` before `npm ci`.
 */
export function loadPublicExportPolicy(manifestPath) {
  const text = readFileSync(manifestPath, 'utf8')
  const lists = {
    from_private_release_source: [],
    public_test_support_from_private_release_source: [],
    preserve_or_update_on_public_surface: [],
    exclude_from_private_export: [],
  }
  let inPublicExport = false
  let currentKey = null
  for (const rawLine of text.split(/\r?\n/u)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indent = rawLine.length - rawLine.trimStart().length
    if (indent === 0) {
      inPublicExport = trimmed === 'public_export:'
      currentKey = null
      continue
    }
    if (!inPublicExport) continue
    if (indent === 2 && trimmed.endsWith(':')) {
      const key = trimmed.slice(0, -1)
      currentKey = Object.hasOwn(lists, key) ? key : null
      continue
    }
    if (indent >= 4 && trimmed.startsWith('- ') && currentKey) {
      lists[currentKey].push(unquoteYamlScalar(trimmed.slice(2)))
    }
  }
  return lists
}

function matchesPattern(relPath, pattern) {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -2)
    return relPath.startsWith(prefix)
  }
  return relPath === pattern
}

export function isPrivateReadmeContent(content) {
  return PRIVATE_README_MARKERS.some((marker) => content.includes(marker))
}

export function isPrivateCheckout(rootDir) {
  return (
    existsSync(join(rootDir, 'AI-MANIFEST.yml')) ||
    existsSync(join(rootDir, 'AGENTS.md')) ||
    existsSync(join(rootDir, 'GOVERNANCE.md')) ||
    existsSync(join(rootDir, 'tools', 'project-control.py'))
  )
}

function collectPublicExportRoots(policy, options = {}) {
  const roots = new Set()
  for (const pattern of [
    ...policy.from_private_release_source,
    ...policy.public_test_support_from_private_release_source,
    ...policy.preserve_or_update_on_public_surface,
  ]) {
    const clean = pattern.replace(/\/\*\*$/u, '')
    const head = clean.split('/')[0]
    if (head && !(head === 'README.md' && (options.privateCheckout || options.publicReadmePath !== undefined))) {
      roots.add(head)
    }
  }
  if (!options.privateCheckout && options.publicReadmePath === undefined) {
    roots.add('README.md')
  }
  return roots
}

function walkRepoFiles(dir, rootDir, results, allowedTopLevel) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    if (dir === rootDir && allowedTopLevel && !allowedTopLevel.has(entry.name)) continue
    const abs = join(dir, entry.name)
    const rel = relative(rootDir, abs).replace(/\\/gu, '/')
    if (entry.isDirectory()) {
      walkRepoFiles(abs, rootDir, results, allowedTopLevel)
    } else if (entry.isFile() && !entry.name.endsWith('.tgz')) {
      results.push(rel)
    }
  }
}

export function collectPublicExportPaths(rootDir, policy, options = {}) {
  const privateRepo = options.privateCheckout ?? isPrivateCheckout(rootDir)
  const includePatterns = [
    ...policy.from_private_release_source,
    ...policy.preserve_or_update_on_public_surface,
  ]
  const supportExact = new Set(policy.public_test_support_from_private_release_source)
  const excludePatterns = privateRepo ? policy.exclude_from_private_export : []
  const allowedTopLevel = collectPublicExportRoots(policy, {
    privateCheckout: privateRepo,
    publicReadmePath: options.publicReadmePath,
  })
  const allFiles = []
  walkRepoFiles(rootDir, rootDir, allFiles, allowedTopLevel)

  return allFiles.filter((relPath) => {
    if (supportExact.has(relPath)) return true
    if (relPath === 'README.md') {
      if (privateRepo || options.publicReadmePath !== undefined) return false
      return true
    }
    if (excludePatterns.some((pattern) => matchesPattern(relPath, pattern))) {
      return false
    }
    return includePatterns.some((pattern) => matchesPattern(relPath, pattern))
  }).sort()
}

function parsePaxRecords(payload) {
  const values = new Map()
  let pos = 0
  while (pos < payload.length) {
    const spaceIdx = payload.indexOf(0x20, pos)
    if (spaceIdx <= pos) {
      throw new Error(`Malformed PAX header record at offset ${pos}`)
    }
    const lenText = payload.subarray(pos, spaceIdx).toString('ascii')
    if (!/^\d+$/u.test(lenText)) {
      throw new Error(`Invalid PAX record byte length "${lenText}" at offset ${pos}`)
    }
    const recordLen = Number.parseInt(lenText, 10)
    const minLen = spaceIdx - pos + 2
    if (!Number.isSafeInteger(recordLen) || recordLen < minLen || pos + recordLen > payload.length) {
      throw new Error(`Out-of-bounds PAX record length ${recordLen} at offset ${pos}`)
    }
    if (payload[pos + recordLen - 1] !== 0x0a) {
      throw new Error(`PAX record missing trailing LF at offset ${pos}`)
    }
    const body = payload.subarray(spaceIdx + 1, pos + recordLen - 1)
    const eqIdx = body.indexOf(0x3d)
    if (eqIdx <= 0) {
      throw new Error(`Malformed PAX key=value record at offset ${pos}`)
    }
    const key = body.subarray(0, eqIdx).toString('utf8')
    const val = body.subarray(eqIdx + 1).toString('utf8')
    values.set(key, val)
    pos += recordLen
  }
  return values
}

export function inspectTarGzArchive(tgzPath) {
  const gz = readFileSync(tgzPath)
  const tar = gunzipSync(gz)
  if (tar.length === 0 || tar.length % 512 !== 0) {
    throw new Error(`Corrupted or misaligned tar archive (${tar.length} bytes): ${tgzPath}`)
  }

  const entries = []
  const dirs = []
  const fileContents = new Map()
  const seen = new Set()
  const seenDirs = new Set()
  let sawEofBlocks = false
  let offset = 0
  let paxPath
  let paxSize
  let gnuLongName

  const USTAR_MAGIC_NUL = Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0x00])
  const USTAR_MAGIC_SPACE = Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0x20])

  const readString = (buf, start, length) => {
    const slice = buf.subarray(start, start + length)
    const zero = slice.indexOf(0)
    return slice.subarray(0, zero === -1 ? length : zero).toString('utf8')
  }

  while (offset < tar.length) {
    if (offset + 512 > tar.length) {
      throw new Error(`Truncated tar header at offset ${offset}`)
    }
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      if (offset + 1024 > tar.length) {
        throw new Error(`Tar archive missing second 512-byte EOF zero block at offset ${offset}`)
      }
      const secondEof = tar.subarray(offset + 512, offset + 1024)
      if (!secondEof.every((byte) => byte === 0)) {
        throw new Error(`Tar archive second EOF block is non-zero at offset ${offset + 512}`)
      }
      for (let i = offset + 1024; i < tar.length; i += 1) {
        if (tar[i] !== 0) {
          throw new Error(`Unexpected non-zero tar data after end-of-archive markers at byte ${i}`)
        }
      }
      sawEofBlocks = true
      break
    }

    const magicSlice = header.subarray(257, 263)
    if (!magicSlice.equals(USTAR_MAGIC_NUL) && !magicSlice.equals(USTAR_MAGIC_SPACE)) {
      throw new Error(`Invalid tar ustar magic bytes at offset ${offset}: ${magicSlice.toString('hex')}`)
    }

    const checksumRaw = readString(header, 148, 8).trim()
    if (!/^[0-7]+$/u.test(checksumRaw)) {
      throw new Error(`Invalid tar header checksum at offset ${offset}: "${checksumRaw}"`)
    }
    const recordedChecksum = Number.parseInt(checksumRaw, 8)
    let unsignedSum = 0
    for (let i = 0; i < 512; i += 1) {
      unsignedSum += i >= 148 && i < 156 ? 0x20 : header[i]
    }
    if (unsignedSum !== recordedChecksum) {
      throw new Error(`Tar header checksum mismatch at offset ${offset}: expected ${recordedChecksum}, computed ${unsignedSum}`)
    }

    const rawName = readString(header, 0, 100)
    const sizeOctal = readString(header, 124, 12).trim()
    if (header[124] & 0x80) {
      throw new Error(`Unsupported binary tar size encoding at offset ${offset}`)
    }
    if (sizeOctal !== '' && !/^[0-7]+$/u.test(sizeOctal)) {
      throw new Error(`Invalid tar entry size "${sizeOctal}" at offset ${offset}`)
    }
    let size = sizeOctal ? Number.parseInt(sizeOctal, 8) : 0
    if (paxSize !== undefined) {
      size = paxSize
    }
    const rawType = header[156]
    const typeFlag = rawType === 0 ? '\0' : String.fromCharCode(rawType)
    const prefix = readString(header, 345, 155)
    offset += 512

    const bodyBlocks = Math.ceil(size / 512) * 512
    if (offset + bodyBlocks > tar.length) {
      throw new Error(`Truncated tar entry payload for "${rawName}" (needs ${offset + bodyBlocks} bytes, have ${tar.length})`)
    }
    const payload = tar.subarray(offset, offset + size)
    offset += bodyBlocks

    if (typeFlag === 'x') {
      const records = parsePaxRecords(payload)
      if (records.has('path')) paxPath = records.get('path')
      if (records.has('size')) {
        const sizeText = records.get('size')
        if (!/^\d+$/u.test(sizeText)) throw new Error(`Invalid PAX size "${sizeText}"`)
        paxSize = Number.parseInt(sizeText, 10)
      }
      continue
    }
    if (typeFlag === 'L') {
      const zeroIdx = payload.indexOf(0)
      gnuLongName = (zeroIdx === -1 ? payload : payload.subarray(0, zeroIdx)).toString('utf8')
      continue
    }

    const fullName = paxPath ?? gnuLongName ?? (prefix ? `${prefix}/${rawName}` : rawName)
    paxPath = undefined
    paxSize = undefined
    gnuLongName = undefined

    if (typeFlag === '5') {
      if (size !== 0) {
        throw new Error(`Tar directory entry "${fullName}" must have zero size, got ${size}`)
      }
      if (fullName !== 'package' && fullName !== 'package/' && !fullName.startsWith('package/')) {
        throw new Error(`Tar directory entry missing literal package/ prefix: ${fullName}`)
      }
      const dirRel = fullName === 'package' || fullName === 'package/' ? '' : fullName.slice('package/'.length).replace(/\/+$/u, '')
      if (dirRel !== '') {
        const dirSegs = dirRel.split('/')
        if (dirSegs.some((seg) => seg === '' || seg === '.' || seg === '..')) {
          throw new Error(`Unsafe tar directory path segments in "${fullName}"`)
        }
        if (seenDirs.has(dirRel)) {
          throw new Error(`Duplicate tar directory entry detected: ${dirRel}`)
        }
        for (let i = 1; i <= dirSegs.length; i += 1) {
          const prefixPath = dirSegs.slice(0, i).join('/')
          if (seen.has(prefixPath)) {
            throw new Error(`Tar directory entry "${dirRel}" shadows regular file "${prefixPath}"`)
          }
        }
        seenDirs.add(dirRel)
        dirs.push(dirRel)
      }
      continue
    }

    if (typeFlag !== '0' && typeFlag !== '\0') {
      throw new Error(`Unsupported or unsafe tar entry type "${typeFlag}" for "${fullName}"`)
    }

    if (!fullName.startsWith('package/') || fullName.length <= 'package/'.length) {
      throw new Error(`Tar regular entry missing literal package/ prefix: ${fullName}`)
    }
    const normalized = fullName.slice('package/'.length)
    if (normalized.endsWith('/')) {
      throw new Error(`Regular tar entry cannot end with slash: ${fullName}`)
    }
    const segments = normalized.split('/')
    if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
      throw new Error(`Unsafe tar entry path segments in "${fullName}"`)
    }
    if (seen.has(normalized)) {
      throw new Error(`Duplicate entry detected in tar archive: ${normalized}`)
    }
    if (seenDirs.has(normalized)) {
      throw new Error(`Tar regular entry "${normalized}" collides with directory entry`)
    }
    for (let i = 1; i < segments.length; i += 1) {
      const ancestor = segments.slice(0, i).join('/')
      if (seen.has(ancestor)) {
        throw new Error(`Tar entry "${normalized}" conflicts with regular file "${ancestor}"`)
      }
    }
    for (const dirPath of seenDirs) {
      if (dirPath.startsWith(`${normalized}/`)) {
        throw new Error(`Tar regular entry "${normalized}" shadows directory entry "${dirPath}"`)
      }
    }
    seen.add(normalized)
    entries.push(normalized)
    fileContents.set(normalized, Buffer.from(payload))
  }

  if (!sawEofBlocks) {
    throw new Error(`Tar archive missing required two 512-byte EOF zero blocks: ${tgzPath}`)
  }
  if (paxPath !== undefined || paxSize !== undefined || gnuLongName !== undefined) {
    throw new Error('Dangling extended tar metadata header without target entry')
  }

  return { entries, dirs, fileContents }
}

export function listTarGzEntries(tgzPath) {
  return inspectTarGzArchive(tgzPath).entries
}

export const REQUIRED_PACKAGE_FILES = [
  'package.json',
  'lib/index.js',
  'lib/client.js',
  'lib/pi-responses-runtime.js',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
  'lib/types/client/search-media.d.ts',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh.json',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
]

export function verifyPublicReadmeBytes(archivedReadmeBytes, expectedReadmeBytes) {
  if (!Buffer.isBuffer(archivedReadmeBytes) || archivedReadmeBytes.length === 0) {
    throw new Error('Public .tgz archive is missing non-empty package/README.md bytes')
  }
  if (expectedReadmeBytes !== undefined && !archivedReadmeBytes.equals(expectedReadmeBytes)) {
    throw new Error('Archived package/README.md bytes differ from validated staged README.md')
  }
}

export function assertArchivedFilesMatchStaged(fileContents, stageDir, stagedPaths) {
  if (!(fileContents instanceof Map) || fileContents.size === 0) {
    throw new Error('Inspected .tgz archive is missing fileContents entries')
  }
  const allowedSet = stagedPaths ? new Set(stagedPaths) : null
  for (const [relPath, archivedBytes] of fileContents.entries()) {
    if (allowedSet && !allowedSet.has(relPath)) {
      throw new Error(`Archived .tgz contains file outside staged export set: ${relPath}`)
    }
    if (!Buffer.isBuffer(archivedBytes)) {
      throw new Error(`Archived .tgz is missing byte buffer for ${relPath}`)
    }
    const stagedPath = join(stageDir, relPath)
    if (!existsSync(stagedPath) || !statSync(stagedPath).isFile()) {
      throw new Error(`Archived .tgz entry is missing staged file on disk: ${relPath}`)
    }
    const stagedBytes = readFileSync(stagedPath)
    if (!archivedBytes.equals(stagedBytes)) {
      throw new Error(`Archived file bytes differ from staged file: ${relPath}`)
    }
  }
}

function compilePackageFilesRule(rawRule) {
  const original = String(rawRule ?? '').trim()
  if (!original) return null
  if (original.includes('\\')) {
    throw new Error(`Unsupported backslash in package.json files pattern: ${rawRule}`)
  }
  if (/[!@+?*]\(/u.test(original)) {
    throw new Error(`Unsupported extglob pattern in package.json files: ${rawRule}`)
  }
  const negated = original.startsWith('!')
  let rule = (negated ? original.slice(1) : original).trim()
  if (!rule) {
    throw new Error(`Unsupported empty package.json files pattern: ${rawRule}`)
  }
  if (rule.includes('!') || /[{}[\]]/u.test(rule)) {
    throw new Error(`Unsupported glob syntax in package.json files pattern: ${rawRule}`)
  }
  rule = rule.replace(/^\.\//u, '').replace(/^\/+/u, '')
  if (!rule) return null
  if (rule === '*' || rule.endsWith('/*')) {
    throw new Error(`Unsupported ambiguous trailing "/*" in package.json files pattern "${rawRule}" (use "**" or an explicit extension like "*.js")`)
  }
  const dirPrefix = rule.endsWith('/') ? rule.slice(0, -1) : null
  let regexSrc = ''
  for (let i = 0; i < rule.length; i += 1) {
    const ch = rule[i]
    if (ch === '*') {
      if (rule[i + 1] === '*') {
        if (rule[i + 2] === '/') {
          regexSrc += '(?:.*/)?'
          i += 2
        } else {
          regexSrc += '.*'
          i += 1
        }
      } else {
        regexSrc += '[^/]*'
      }
    } else if (ch === '?') {
      regexSrc += '[^/]'
    } else {
      regexSrc += ch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    }
  }
  const re = new RegExp(`^${regexSrc}$`, 'u')
  return {
    negated,
    matches: (relPath) => {
      if (dirPrefix !== null) return relPath.startsWith(`${dirPrefix}/`)
      if (re.test(relPath)) return true
      if (!rule.includes('*') && !rule.includes('?') && relPath.startsWith(`${rule}/`)) return true
      return false
    },
  }
}

export function deriveExpectedPackageFiles(stageDir, stagedFiles, options = {}) {
  const pkgPath = join(stageDir, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error('Staged export is missing package.json')
  }
  const stagedPkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (!Array.isArray(stagedPkg?.files) || stagedPkg.files.length === 0) {
    throw new Error('Staged package.json must declare a non-empty files allowlist')
  }
  const compiledRules = stagedPkg.files.map(compilePackageFilesRule).filter(Boolean)
  const expected = new Set()
  const filesList = Array.isArray(stagedFiles) ? stagedFiles : [...stagedFiles]
  for (const relPath of filesList) {
    let included = false
    for (const rule of compiledRules) {
      if (rule.matches(relPath)) {
        included = !rule.negated
      }
    }
    if (
      relPath === 'package.json' ||
      /^licen[cs]e(?:\.[^/]+)?$/iu.test(relPath) ||
      (options.allowPublicReadme && relPath === 'README.md')
    ) {
      included = true
    }
    if (included) {
      expected.add(relPath)
    }
  }
  if (options.allowPublicReadme && !expected.has('README.md')) {
    throw new Error('Expected runtime package files missing required public README.md')
  }
  return [...expected].sort()
}

let cachedEsbuildModule
function loadEsbuildModule() {
  if (cachedEsbuildModule !== undefined) return cachedEsbuildModule
  const require = createRequire(import.meta.url)
  try {
    cachedEsbuildModule = require('esbuild')
    return cachedEsbuildModule
  } catch (error) {
    if (error && (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND')) {
      cachedEsbuildModule = null
      return null
    }
    throw error
  }
}

function extractRelativeJsImportsWithEsbuild(esbuild, code, fileName = 'module.mjs') {
  const result = esbuild.buildSync({
    stdin: {
      contents: code,
      loader: 'js',
      resolveDir: process.cwd(),
      sourcefile: fileName,
    },
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    external: ['*', './*', '../*', '.*'],
  })
  const entry = Object.values(result.metafile?.inputs ?? {})[0]
  if (!entry || !Array.isArray(entry.imports)) return []
  return entry.imports
    .filter((item) => item.kind === 'import-statement' || item.kind === 'dynamic-import' || item.kind === 'require-call')
    .map((item) => item.path)
}

function decodeJsEscapesFallback(rawBody) {
  return rawBody.replace(
    /\\(?:(\r\n|[\r\n\u2028\u2029])|u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(.))/gu,
    (_m, lineCont, uBrace, u4, x2, simple) => {
      if (lineCont) return ''
      if (uBrace) return String.fromCodePoint(Number.parseInt(uBrace, 16))
      if (u4) return String.fromCharCode(Number.parseInt(u4, 16))
      if (x2) return String.fromCharCode(Number.parseInt(x2, 16))
      if (simple === 'n') return '\n'
      if (simple === 'r') return '\r'
      if (simple === 't') return '\t'
      return simple ?? ''
    },
  )
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'throw',
  'case',
  'delete',
  'void',
  'typeof',
  'in',
  'instanceof',
  'new',
  'of',
  'await',
  'yield',
  'else',
  'do',
  'export',
  'default',
])

function tokenizeJsForImports(code) {
  const tokens = []
  const templateBraceStack = []
  const parenStack = []
  const braceKindStack = []
  const pendingExprBodyStack = []
  const pendingCaseStack = []
  let braceDepth = 0
  let bracketDepth = 0
  let line = 1
  let canStartRegex = true
  let atStatementStart = true
  let declModifier = false
  let prevWasExport = false
  let i = 0

  const isMemberPrev = (tok) => tok?.type === 'punct' && (tok.value === '.' || tok.value === '?.')
  const pruneOutOfScopeStacks = () => {
    while (pendingExprBodyStack.length > 0) {
      const top = pendingExprBodyStack.at(-1)
      if (
        top.braceDepth > braceDepth ||
        (top.braceDepth === braceDepth && (top.parenLen > parenStack.length || top.bracketDepth > bracketDepth))
      ) {
        pendingExprBodyStack.pop()
      } else {
        break
      }
    }
    while (pendingCaseStack.length > 0) {
      const top = pendingCaseStack.at(-1)
      if (
        top.braceDepth > braceDepth ||
        (top.braceDepth === braceDepth && (top.parenLen > parenStack.length || top.bracketDepth > bracketDepth))
      ) {
        pendingCaseStack.pop()
      } else {
        break
      }
    }
  }

  const isJsLineTerminator = (c) => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029'

  const scanTemplateChunk = (startIdx) => {
    let raw = ''
    let j = startIdx
    const startLine = line
    while (j < code.length) {
      const ch = code[j]
      if (ch === '\\' && j + 1 < code.length) {
        if (code[j + 1] === '\r' && code[j + 2] === '\n') {
          raw += code.slice(j, j + 3)
          line += 1
          j += 3
          continue
        }
        if (isJsLineTerminator(code[j + 1])) line += 1
        raw += code[j] + code[j + 1]
        j += 2
        continue
      }
      if (ch === '`') {
        i = j + 1
        return { kind: 'end', raw, line: startLine }
      }
      if (ch === '$' && code[j + 1] === '{') {
        i = j + 2
        return { kind: 'expr', raw, line: startLine }
      }
      if (ch === '\r' && code[j + 1] === '\n') {
        line += 1
        raw += '\r\n'
        j += 2
        continue
      }
      if (isJsLineTerminator(ch)) line += 1
      raw += ch
      j += 1
    }
    i = j
    return { kind: 'eof', raw, line: startLine }
  }

  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]

    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') {
      i += 1
      continue
    }
    if (ch === '\r' && next === '\n') {
      line += 1
      i += 2
      continue
    }
    if (isJsLineTerminator(ch)) {
      line += 1
      i += 1
      continue
    }
    if (ch === '/' && next === '/') {
      i += 2
      while (i < code.length && !isJsLineTerminator(code[i])) i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2)
      const slice = end === -1 ? code.slice(i + 2) : code.slice(i + 2, end)
      for (let k = 0; k < slice.length; k += 1) {
        const c = slice[k]
        if (c === '\r' && slice[k + 1] === '\n') {
          line += 1
          k += 1
        } else if (isJsLineTerminator(c)) {
          line += 1
        }
      }
      i = end === -1 ? code.length : end + 2
      continue
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      const tokLine = line
      let raw = ''
      i += 1
      while (i < code.length) {
        const c = code[i]
        if (c === '\\' && i + 1 < code.length) {
          if (code[i + 1] === '\r' && code[i + 2] === '\n') {
            raw += code.slice(i, i + 3)
            line += 1
            i += 3
            continue
          }
          if (isJsLineTerminator(code[i + 1])) line += 1
          raw += c + code[i + 1]
          i += 2
          continue
        }
        if (c === quote) {
          i += 1
          break
        }
        if (c === '\r' && code[i + 1] === '\n') {
          line += 1
          raw += '\r\n'
          i += 2
          continue
        }
        if (isJsLineTerminator(c)) line += 1
        raw += c
        i += 1
      }
      tokens.push({ type: 'string', value: decodeJsEscapesFallback(raw), line: tokLine })
      canStartRegex = false
      atStatementStart = false
      declModifier = false
      prevWasExport = false
      continue
    }
    if (ch === '`') {
      const chunk = scanTemplateChunk(i + 1)
      if (chunk.kind === 'end') {
        tokens.push({ type: 'string', value: decodeJsEscapesFallback(chunk.raw), line: chunk.line })
        canStartRegex = false
        atStatementStart = false
      } else if (chunk.kind === 'expr') {
        templateBraceStack.push(braceDepth)
        braceDepth += 1
        tokens.push({ type: 'tpl', value: '${', line: chunk.line })
        canStartRegex = true
        atStatementStart = false
      } else {
        tokens.push({ type: 'tpl', value: '`', line: chunk.line })
        canStartRegex = false
        atStatementStart = false
      }
      declModifier = false
      prevWasExport = false
      continue
    }
    if (ch === '/' && canStartRegex) {
      const tokLine = line
      i += 1
      let inClass = false
      while (i < code.length) {
        const c = code[i]
        if (c === '\\' && i + 1 < code.length) {
          i += 2
          continue
        }
        if (c === '[' && !inClass) {
          inClass = true
        } else if (c === ']' && inClass) {
          inClass = false
        } else if (c === '/' && !inClass) {
          i += 1
          break
        } else if (isJsLineTerminator(c)) {
          break
        }
        i += 1
      }
      while (i < code.length && /[A-Za-z]/u.test(code[i])) i += 1
      tokens.push({ type: 'regex', value: '/re/', line: tokLine })
      canStartRegex = false
      atStatementStart = false
      declModifier = false
      prevWasExport = false
      continue
    }
    if (/[A-Za-z_$]/u.test(ch)) {
      const tokLine = line
      let end = i + 1
      while (end < code.length && /[A-Za-z0-9_$]/u.test(code[end])) end += 1
      const word = code.slice(i, end)
      i = end
      const prev1 = tokens.at(-1)
      const prev2 = tokens.at(-2)
      const topScope = braceKindStack.at(-1) ?? { kind: 'block', depth: 0, parenLen: 0, bracketDepth: 0 }
      const inTemplateExprRoot =
        templateBraceStack.length > 0 && topScope.depth <= templateBraceStack.at(-1)
      const inLexicalBlock =
        !inTemplateExprRoot &&
        topScope.kind !== 'object' &&
        parenStack.length === topScope.parenLen &&
        bracketDepth === topScope.bracketDepth
      const isReturnAsiBoundary =
        prev1?.type === 'ident' &&
        (prev1.value === 'return' || prev1.value === 'yield') &&
        prev1.line !== tokLine &&
        !isMemberPrev(prev2)
      const asiBoundary = Boolean(prev1 && prev1.line !== tokLine && (!canStartRegex || isReturnAsiBoundary))
      const effStmtStart = inLexicalBlock && (atStatementStart || asiBoundary)
      const isMember = isMemberPrev(prev1)
      if (!isMember) {
        if (word === 'case' && topScope.kind !== 'object') {
          pendingCaseStack.push({
            braceDepth,
            parenLen: parenStack.length,
            bracketDepth,
            ternaryDepth: 0,
          })
        } else if (word === 'function' || word === 'class') {
          const isDeclaration = inLexicalBlock && (effStmtStart || declModifier)
          if (!isDeclaration) {
            pendingExprBodyStack.push({
              braceDepth,
              parenLen: parenStack.length,
              bracketDepth,
            })
          }
        }
      }
      if (!isMember && word === 'export' && effStmtStart) {
        declModifier = true
        prevWasExport = true
      } else if (!isMember && word === 'default' && prevWasExport) {
        declModifier = true
        prevWasExport = false
      } else if (!isMember && word === 'async' && (effStmtStart || declModifier)) {
        declModifier = true
        prevWasExport = false
      } else {
        declModifier = false
        prevWasExport = false
      }
      tokens.push({ type: 'ident', value: word, line: tokLine })
      canStartRegex = REGEX_PRECEDING_KEYWORDS.has(word)
      atStatementStart = false
      continue
    }
    if (/[0-9]/u.test(ch) || (ch === '.' && /[0-9]/u.test(next ?? ''))) {
      const start = i
      const tokLine = line
      let end = i + 1
      while (end < code.length && /[0-9A-Za-z_.]/u.test(code[end])) end += 1
      i = end
      tokens.push({ type: 'number', value: code.slice(start, end), line: tokLine })
      canStartRegex = false
      atStatementStart = false
      declModifier = false
      prevWasExport = false
      continue
    }
    if (ch === '}') {
      const tokLine = line
      i += 1
      braceDepth = Math.max(0, braceDepth - 1)
      pruneOutOfScopeStacks()
      if (templateBraceStack.length > 0 && templateBraceStack.at(-1) === braceDepth) {
        templateBraceStack.pop()
        const chunk = scanTemplateChunk(i)
        if (chunk.kind === 'expr') {
          templateBraceStack.push(braceDepth)
          braceDepth += 1
          tokens.push({ type: 'tpl', value: '${', line: chunk.line })
          canStartRegex = true
        } else {
          tokens.push({ type: 'tpl', value: '`', line: chunk.line })
          canStartRegex = false
        }
        atStatementStart = false
        declModifier = false
        prevWasExport = false
        continue
      }
      const closedScope = braceKindStack.length > 0 ? braceKindStack.pop() : { kind: 'block', depth: 0, parenLen: 0, bracketDepth: 0 }
      tokens.push({ type: 'punct', value: '}', line: tokLine })
      canStartRegex = closedScope.kind === 'block'
      atStatementStart = closedScope.kind === 'block'
      declModifier = false
      prevWasExport = false
      continue
    }
    const tokLine = line
    let punct = ch
    if (code.startsWith('...', i) || code.startsWith('===', i) || code.startsWith('!==', i)) {
      punct = code.slice(i, i + 3)
      i += 3
    } else if (
      code.startsWith('=>', i) ||
      code.startsWith('?.', i) ||
      code.startsWith('++', i) ||
      code.startsWith('--', i) ||
      code.startsWith('==', i) ||
      code.startsWith('!=', i) ||
      code.startsWith('<=', i) ||
      code.startsWith('>=', i) ||
      code.startsWith('&&', i) ||
      code.startsWith('||', i) ||
      code.startsWith('??', i) ||
      (next === '=' && '+-*/%&|^!<>'.includes(ch))
    ) {
      punct = code.slice(i, i + 2)
      i += 2
    } else {
      i += 1
    }
    const prev1 = tokens.at(-1)
    const prev2 = tokens.at(-2)
    const prev3 = tokens.at(-3)
    if (punct === ';' || punct === ',' || punct === '=>') {
      while (pendingExprBodyStack.length > 0) {
        const topExpr = pendingExprBodyStack.at(-1)
        if (
          topExpr.braceDepth === braceDepth &&
          topExpr.parenLen === parenStack.length &&
          topExpr.bracketDepth === bracketDepth
        ) {
          pendingExprBodyStack.pop()
        } else {
          break
        }
      }
    }
    if (punct === ':' && prev1?.type === 'ident' && (prev1.value === 'function' || prev1.value === 'class')) {
      while (pendingExprBodyStack.length > 0) {
        const topExpr = pendingExprBodyStack.at(-1)
        if (
          topExpr.braceDepth === braceDepth &&
          topExpr.parenLen === parenStack.length &&
          topExpr.bracketDepth === bracketDepth
        ) {
          pendingExprBodyStack.pop()
        } else {
          break
        }
      }
    }
    let isSwitchColon = false
    if (pendingCaseStack.length > 0) {
      const topCase = pendingCaseStack.at(-1)
      if (
        topCase.braceDepth === braceDepth &&
        topCase.parenLen === parenStack.length &&
        topCase.bracketDepth === bracketDepth
      ) {
        if (punct === '?') {
          topCase.ternaryDepth += 1
        } else if (punct === ':') {
          if (topCase.ternaryDepth > 0) {
            topCase.ternaryDepth -= 1
          } else {
            pendingCaseStack.pop()
            isSwitchColon = true
          }
        }
      }
    }
    const topScopeForPunct = braceKindStack.at(-1) ?? { kind: 'block', depth: 0, parenLen: 0, bracketDepth: 0 }
    const isSwitchDefaultColon =
      punct === ':' &&
      topScopeForPunct.kind !== 'object' &&
      prev1?.type === 'ident' &&
      prev1.value === 'default' &&
      !isMemberPrev(prev2)
    if (punct === '[') {
      bracketDepth += 1
    } else if (punct === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
      pruneOutOfScopeStacks()
    }
    if (punct === '{') {
      let braceKind = 'block'
      const topExpr = pendingExprBodyStack.at(-1)
      if (
        topExpr &&
        topExpr.braceDepth === braceDepth &&
        topExpr.parenLen === parenStack.length &&
        topExpr.bracketDepth === bracketDepth
      ) {
        pendingExprBodyStack.pop()
        braceKind = 'expr-block'
      } else if (prev1) {
        if (prev1.type === 'tpl' && prev1.value === '${') {
          braceKind = 'object'
        } else if (prev1.type === 'ident') {
          const isReturnAsiBrace =
            (prev1.value === 'return' || prev1.value === 'yield') &&
            prev1.line !== tokLine &&
            !isMemberPrev(prev2)
          if (
            !isMemberPrev(prev2) &&
            !isReturnAsiBrace &&
            (prev1.value === 'return' ||
              prev1.value === 'throw' ||
              prev1.value === 'yield' ||
              prev1.value === 'await' ||
              prev1.value === 'in' ||
              prev1.value === 'of' ||
              prev1.value === 'instanceof' ||
              prev1.value === 'delete' ||
              prev1.value === 'void' ||
              prev1.value === 'typeof' ||
              prev1.value === 'new' ||
              prev1.value === 'default')
          ) {
            braceKind = 'object'
          }
        } else if (prev1.type === 'punct') {
          const v = prev1.value
          if (v === ':') {
            const isLabel =
              topScopeForPunct.kind !== 'object' &&
              prev2?.type === 'ident' &&
              (tokens.length === 2 ||
                (prev3?.type === 'punct' && (prev3.value === ';' || prev3.value === '{' || prev3.value === '}')) ||
                prev3?.line !== prev2.line)
            braceKind = prev1.isSwitchColon || isLabel ? 'block' : 'object'
          } else if (v !== ';' && v !== '{' && v !== '}' && v !== ')' && v !== '=>') {
            braceKind = 'object'
          }
        }
      }
      braceDepth += 1
      braceKindStack.push({
        kind: braceKind,
        depth: braceDepth,
        parenLen: parenStack.length,
        bracketDepth,
      })
      tokens.push({ type: 'punct', value: punct, line: tokLine })
      canStartRegex = true
      atStatementStart = braceKind !== 'object'
      declModifier = false
      prevWasExport = false
      continue
    }
    if (punct === '(') {
      const isControl =
        prev1?.type === 'ident' &&
        (
          ((prev1.value === 'if' || prev1.value === 'while' || prev1.value === 'for' || prev1.value === 'with') && !isMemberPrev(prev2)) ||
          (prev1.value === 'await' && prev2?.type === 'ident' && prev2.value === 'for' && !isMemberPrev(prev3))
        )
      parenStack.push(Boolean(isControl))
    } else if (punct === ')') {
      const closedControl = parenStack.length > 0 ? parenStack.pop() : false
      pruneOutOfScopeStacks()
      tokens.push({ type: 'punct', value: punct, line: tokLine })
      canStartRegex = closedControl
      atStatementStart = closedControl
      declModifier = false
      prevWasExport = false
      continue
    }
    const punctTok =
      punct === ':' && (isSwitchColon || isSwitchDefaultColon)
        ? { type: 'punct', value: punct, line: tokLine, isSwitchColon: true }
        : { type: 'punct', value: punct, line: tokLine }
    tokens.push(punctTok)
    canStartRegex =
      punct !== ')' &&
      punct !== ']' &&
      punct !== '.' &&
      punct !== '?.' &&
      punct !== '++' &&
      punct !== '--'
    atStatementStart = punct === ';' || Boolean(punctTok.isSwitchColon)
    declModifier = false
    prevWasExport = false
  }
  return tokens
}

// Fallback used only in pre-`npm ci` governance dry-run when `esbuild` is not installed yet.
export function extractRelativeJsImportsFallback(code) {
  const tokens = tokenizeJsForImports(code)
  const specifiers = []
  let parenDepth = 0
  let braceDepth = 0

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]
    const prev = i > 0 ? tokens[i - 1] : undefined
    if (tok.type === 'punct') {
      if (tok.value === '(') parenDepth += 1
      else if (tok.value === ')') parenDepth = Math.max(0, parenDepth - 1)
      else if (tok.value === '{') braceDepth += 1
      else if (tok.value === '}') braceDepth = Math.max(0, braceDepth - 1)
      continue
    }
    if (tok.type !== 'ident') continue

    // Dynamic import('specifier' [, { ... }])
    if (
      tok.value === 'import' &&
      prev?.value !== '.' &&
      prev?.value !== '?.' &&
      tokens[i + 1]?.value === '(' &&
      tokens[i + 2]?.type === 'string' &&
      (tokens[i + 3]?.value === ')' || tokens[i + 3]?.value === ',')
    ) {
      specifiers.push(tokens[i + 2].value)
      continue
    }

    const atStmtBoundary =
      parenDepth === 0 &&
      braceDepth === 0 &&
      prev?.value !== '.' &&
      prev?.value !== '?.' &&
      (prev === undefined || prev.value === ';' || prev.value === '}' || prev.line !== tok.line)
    if (!atStmtBoundary) continue

    if (tok.value === 'import') {
      // Side-effect import './x.js'
      if (tokens[i + 1]?.type === 'string') {
        specifiers.push(tokens[i + 1].value)
        continue
      }
      // import.meta / import(...) already handled above
      if (tokens[i + 1]?.value === '.' || tokens[i + 1]?.value === '(') continue
      let clauseBraceDepth = 0
      for (let j = i + 1; j < tokens.length; j += 1) {
        const cur = tokens[j]
        if (cur.value === '{') clauseBraceDepth += 1
        else if (cur.value === '}') clauseBraceDepth = Math.max(0, clauseBraceDepth - 1)
        else if (cur.value === ';' && clauseBraceDepth === 0) break
        else if (
          clauseBraceDepth === 0 &&
          cur.type === 'ident' &&
          cur.value === 'from' &&
          tokens[j + 1]?.type === 'string'
        ) {
          specifiers.push(tokens[j + 1].value)
          break
        }
      }
      continue
    }

    if (tok.value === 'export') {
      const nextTok = tokens[i + 1]
      if (!nextTok || (nextTok.value !== '*' && nextTok.value !== '{' && nextTok.value !== 'type')) {
        continue
      }
      let clauseBraceDepth = 0
      let invalidReexport = false
      for (let j = i + 1; j < tokens.length; j += 1) {
        const cur = tokens[j]
        if (cur.value === '{') clauseBraceDepth += 1
        else if (cur.value === '}') {
          if (clauseBraceDepth === 0) break
          clauseBraceDepth -= 1
        } else if (cur.value === ';' && clauseBraceDepth === 0) {
          break
        } else if (
          clauseBraceDepth === 0 &&
          cur.type === 'ident' &&
          ['function', 'class', 'const', 'let', 'var', 'default', 'async', 'interface'].includes(cur.value)
        ) {
          invalidReexport = true
          break
        } else if (
          clauseBraceDepth === 0 &&
          cur.type === 'ident' &&
          cur.value === 'from' &&
          tokens[j + 1]?.type === 'string'
        ) {
          specifiers.push(tokens[j + 1].value)
          break
        } else if (clauseBraceDepth === 0 && cur.value === '=') {
          invalidReexport = true
          break
        }
      }
      if (invalidReexport) continue
    }
  }
  return specifiers
}

export function extractRelativeJsImports(code, options = {}) {
  const fileName = options.fileName ?? '__lcx_inspect__.mjs'
  const esbuild = loadEsbuildModule()
  if (esbuild) {
    return extractRelativeJsImportsWithEsbuild(esbuild, code, fileName)
  }
  if (options.allowWithoutEsbuild === true) {
    return extractRelativeJsImportsFallback(code)
  }
  throw new Error('esbuild AST/bundler parser is required for extractRelativeJsImports')
}

export function assertRuntimeImportClosure(expectedFiles, stageDir, options = {}) {
  const expectedSet = new Set(expectedFiles)
  const pkgRootPrefix = '/__pkg_root__/'
  const pkgRootBase = `https://pkg.local${pkgRootPrefix}`
  for (const relPath of expectedSet) {
    if (!/\.(?:js|mjs)$/u.test(relPath)) continue
    const code = readFileSync(join(stageDir, relPath), 'utf8')
    const specifiers = extractRelativeJsImports(code, {
      fileName: relPath,
      allowWithoutEsbuild: options.allowWithoutEsbuild === true,
    })
    for (const specifier of specifiers) {
      if (
        specifier !== '.' &&
        specifier !== '..' &&
        !specifier.startsWith('./') &&
        !specifier.startsWith('../')
      ) {
        continue
      }
      const qHashIdx = specifier.search(/[?#]/u)
      const specPath = qHashIdx === -1 ? specifier : specifier.slice(0, qHashIdx)
      if (/%(?:2f|5c)/iu.test(specPath)) {
        throw new Error(`Relative runtime import "${specifier}" in "${relPath}" uses forbidden encoded path separator`)
      }
      let decodedSpecPath
      try {
        decodedSpecPath = decodeURIComponent(specPath)
      } catch {
        throw new Error(`Relative runtime import "${specifier}" in "${relPath}" has invalid percent encoding`)
      }
      const normalizedRaw = posix.normalize(posix.join(posix.dirname(relPath), specPath))
      const normalizedDecoded = posix.normalize(posix.join(posix.dirname(relPath), decodedSpecPath))
      if (
        normalizedRaw === '..' ||
        normalizedRaw.startsWith('../') ||
        normalizedDecoded === '..' ||
        normalizedDecoded.startsWith('../')
      ) {
        throw new Error(`Relative runtime import "${specifier}" in "${relPath}" escapes package root`)
      }
      const resolvedUrl = new URL(specifier, `${pkgRootBase}${relPath}`)
      if (resolvedUrl.origin !== 'https://pkg.local' || !resolvedUrl.pathname.startsWith(pkgRootPrefix)) {
        throw new Error(`Relative runtime import "${specifier}" in "${relPath}" escapes package root`)
      }
      const target = decodeURIComponent(resolvedUrl.pathname.slice(pkgRootPrefix.length))
      if (!expectedSet.has(target)) {
        throw new Error(`Missing imported runtime module "${target}" referenced by "${relPath}"`)
      }
    }
  }
}

export function assertExactFileSet(actualFiles, expectedFiles, sourceLabel = 'npm archive') {
  const actualSet = new Set(actualFiles)
  const expectedSet = new Set(expectedFiles)
  const missing = [...expectedSet].filter((entry) => !actualSet.has(entry))
  const extra = [...actualSet].filter((entry) => !expectedSet.has(entry))
  if (missing.length > 0 || extra.length > 0) {
    const parts = []
    if (missing.length > 0) parts.push(`missing [${missing.join(', ')}]`)
    if (extra.length > 0) parts.push(`unexpected [${extra.join(', ')}]`)
    throw new Error(`${sourceLabel} file set mismatches expected staged package files: ${parts.join('; ')}`)
  }
}

export function assertSafeArchiveDirectories(dirs, options = {}) {
  const allowPublicReadme = Boolean(options.allowPublicReadme)
  const stagedSet = options.stagedSet instanceof Set ? options.stagedSet : null
  const forbiddenDirs = (allowPublicReadme
    ? FORBIDDEN_PACKAGE_ENTRIES.filter((entry) => entry !== 'README.md')
    : FORBIDDEN_PACKAGE_ENTRIES
  ).map((entry) => entry.replace(/\/+$/u, ''))
  for (const rawDir of dirs) {
    const dirRel = String(rawDir || '').replace(/\/+$/u, '')
    if (!dirRel) continue
    if (
      forbiddenDirs.some((rule) => dirRel === rule || dirRel.startsWith(`${rule}/`)) ||
      dirRel === 'node_modules' ||
      dirRel.startsWith('node_modules/') ||
      dirRel.includes('/node_modules/')
    ) {
      throw new Error(`Private or forbidden directory entry detected in npm archive: ${dirRel}/`)
    }
    if (stagedSet && ![...stagedSet].some((stagedPath) => stagedPath.startsWith(`${dirRel}/`))) {
      throw new Error(`Tar directory entry "${dirRel}/" has no matching staged files`)
    }
  }
}

export function assertSafeArchiveEntries(entries, options = {}) {
  const allowPublicReadme = options.allowPublicReadme === true
  const privateReadme = options.privateReadmeContent
  const forbidden = allowPublicReadme
    ? FORBIDDEN_PACKAGE_ENTRIES.filter((entry) => entry !== 'README.md')
    : FORBIDDEN_PACKAGE_ENTRIES

  const bad = entries.filter((name) =>
    forbidden.some((rule) => (rule.endsWith('/') ? name.startsWith(rule) : name === rule)),
  )
  if (bad.length > 0) {
    throw new Error(`Private package leakage detected in npm archive: ${bad.join(', ')}`)
  }
  const bundled = entries.filter((name) => name === 'node_modules' || name.startsWith('node_modules/') || name.includes('/node_modules/'))
  if (bundled.length > 0) {
    throw new Error(`Unexpected bundled node_modules entries in npm archive: ${bundled.join(', ')}`)
  }
  if (!allowPublicReadme) {
    const readmeHits = entries.filter((name) => /^readme(?:\.md|\.markdown)?$/iu.test(name))
    if (readmeHits.length > 0) {
      throw new Error(`Unexpected root README in private local package: ${readmeHits.join(', ')}`)
    }
  } else {
    if (options.requireReadme && !entries.includes('README.md')) {
      throw new Error('Public package archive is missing required root README.md')
    }
    if (options.stagedReadmeContent !== undefined) {
      if (isPrivateReadmeContent(options.stagedReadmeContent)) {
        throw new Error('Packaged README contains private control-plane content')
      }
      if (privateReadme !== undefined && options.stagedReadmeContent === privateReadme) {
        throw new Error('Packaged README matches the private control-plane README.md')
      }
    }
  }
  if (options.stagedSet) {
    const unexpected = entries.filter((name) => !options.stagedSet.has(name))
    if (unexpected.length > 0) {
      throw new Error(`Unexpected unstaged entry in npm archive: ${unexpected.join(', ')}`)
    }
  }
}

export function stageCuratedExport({ rootDir, stageDir, publicReadmePath, mode }) {
  const manifestPath = join(rootDir, 'PUBLIC-RELEASE-MANIFEST.yml')
  const privateRepo = isPrivateCheckout(rootDir)
  if (mode === 'public' && privateRepo) {
    throw new Error('Refusing --public packaging on a checkout containing private control-plane files')
  }
  if (mode === 'private' && !privateRepo) {
    throw new Error('Refusing --private packaging on a checkout without private control-plane files')
  }
  const policy = existsSync(manifestPath)
    ? loadPublicExportPolicy(manifestPath)
    : {
        from_private_release_source: ['package.json', 'package-lock.json', 'lib/**', 'locale/**', 'icon.svg', 'cordis.patch.yml', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'README_EN.md', 'README.md'],
        public_test_support_from_private_release_source: [],
        preserve_or_update_on_public_surface: [],
        exclude_from_private_export: privateRepo ? FORBIDDEN_PACKAGE_ENTRIES : [],
      }

  const selected = collectPublicExportPaths(rootDir, policy, {
    privateCheckout: privateRepo,
    publicReadmePath,
  })
  for (const relPath of selected) {
    const src = join(rootDir, relPath)
    const dst = join(stageDir, relPath)
    mkdirSync(dirname(dst), { recursive: true })
    cpSync(src, dst)
  }

  let stagedReadmeContent
  let stagedReadmeBytes
  let allowPublicReadme = false
  if (publicReadmePath !== undefined) {
    const resolvedReadme = resolve(rootDir, publicReadmePath)
    stagedReadmeBytes = readFileSync(resolvedReadme)
    stagedReadmeContent = stagedReadmeBytes.toString('utf8')
    const privateReadmePath = join(rootDir, 'README.md')
    const privateReadmeContent = privateRepo && existsSync(privateReadmePath) ? readFileSync(privateReadmePath, 'utf8') : undefined
    assertSafeArchiveEntries(['README.md'], {
      allowPublicReadme: true,
      requireReadme: true,
      stagedReadmeContent,
      privateReadmeContent,
    })
    writeFileSync(join(stageDir, 'README.md'), stagedReadmeBytes)
    allowPublicReadme = true
  } else if (!privateRepo) {
    const publicReadmeFile = join(stageDir, 'README.md')
    if (!existsSync(publicReadmeFile)) {
      throw new Error('Public checkout requires root README.md for packaging')
    }
    stagedReadmeBytes = readFileSync(publicReadmeFile)
    stagedReadmeContent = stagedReadmeBytes.toString('utf8')
    assertSafeArchiveEntries(['README.md'], {
      allowPublicReadme: true,
      requireReadme: true,
      stagedReadmeContent,
    })
    allowPublicReadme = true
  }

  const stagedFiles = allowPublicReadme && !selected.includes('README.md')
    ? [...selected, 'README.md'].sort()
    : selected

  return {
    privateCheckout: privateRepo,
    selected,
    stagedFiles,
    allowPublicReadme,
    stagedReadmeContent,
    stagedReadmeBytes,
  }
}

function parseArgs(argv) {
  let publicReadmePath
  let dryRun = false
  let json = false
  let quiet = false
  let loglevel
  let packDestination
  let mode

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--quiet') {
      quiet = true
      continue
    }
    if (arg === '--public') {
      if (mode === 'private') throw new Error('Cannot combine --public and --private arguments to pack-local.mjs')
      mode = 'public'
      continue
    }
    if (arg === '--private') {
      if (mode === 'public') throw new Error('Cannot combine --public and --private arguments to pack-local.mjs')
      mode = 'private'
      continue
    }
    if (arg === '--loglevel') {
      if (i + 1 >= argv.length || !argv[i + 1] || argv[i + 1].startsWith('-')) {
        throw new Error('--loglevel requires a level value')
      }
      loglevel = argv[i + 1]
      i += 1
      continue
    }
    if (arg.startsWith('--loglevel=')) {
      const val = arg.slice('--loglevel='.length)
      if (!val) throw new Error('--loglevel requires a non-empty level value')
      loglevel = val
      continue
    }
    if (arg === '--pack-destination') {
      if (i + 1 >= argv.length || !argv[i + 1] || argv[i + 1].startsWith('-')) {
        throw new Error('--pack-destination requires a directory path')
      }
      packDestination = argv[i + 1]
      i += 1
      continue
    }
    if (arg.startsWith('--pack-destination=')) {
      const val = arg.slice('--pack-destination='.length)
      if (!val) throw new Error('--pack-destination requires a non-empty directory path')
      packDestination = val
      continue
    }
    if (arg === '--public-readme') {
      if (i + 1 >= argv.length || !argv[i + 1] || argv[i + 1].startsWith('-')) {
        throw new Error('--public-readme requires a file path')
      }
      publicReadmePath = argv[i + 1]
      i += 1
      continue
    }
    if (arg.startsWith('--public-readme=')) {
      const val = arg.slice('--public-readme='.length)
      if (!val) throw new Error('--public-readme requires a non-empty file path')
      publicReadmePath = val
      continue
    }
    throw new Error(`Unsupported argument to pack-local.mjs: ${arg}`)
  }

  return { publicReadmePath, dryRun, json, quiet, loglevel, packDestination, mode }
}

export function runLocalPack(argv = process.argv.slice(2), options = {}) {
  const rootDir = options.rootDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const cwd = options.cwd ?? process.cwd()
  const parsedArgs = parseArgs(argv)
  const tempRoot = mkdtempSync(join(tmpdir(), 'lcx-pack-local-'))
  const stageDir = join(tempRoot, 'package')
  const cacheDir = join(tempRoot, 'npm-cache')
  mkdirSync(stageDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })

  try {
    const staged = stageCuratedExport({
      rootDir,
      stageDir,
      publicReadmePath: parsedArgs.publicReadmePath,
      mode: parsedArgs.mode,
    })
    const stagedSet = new Set(staged.stagedFiles)
    const expectedPackageFiles = deriveExpectedPackageFiles(stageDir, staged.stagedFiles, {
      allowPublicReadme: staged.allowPublicReadme,
    })
    const expectedPackageSet = new Set(expectedPackageFiles)
    for (const requiredFile of REQUIRED_PACKAGE_FILES) {
      if (!expectedPackageSet.has(requiredFile)) {
        throw new Error(`Expected runtime package files is missing required runtime entry: ${requiredFile}`)
      }
    }
    assertRuntimeImportClosure(expectedPackageFiles, stageDir, {
      allowWithoutEsbuild: parsedArgs.dryRun && parsedArgs.mode !== 'public' && staged.privateCheckout,
    })
    const privateReadmePath = join(rootDir, 'README.md')
    const privateReadmeContent = staged.privateCheckout && existsSync(privateReadmePath)
      ? readFileSync(privateReadmePath, 'utf8')
      : undefined

    const sharedFlags = []
    if (parsedArgs.quiet) sharedFlags.push('--quiet')
    if (parsedArgs.loglevel !== undefined) sharedFlags.push('--loglevel', parsedArgs.loglevel)
    const resolvedDestination = parsedArgs.packDestination !== undefined
      ? resolve(cwd, parsedArgs.packDestination)
      : cwd

    const runNpmPack = (extraArgs, isDryMode) => {
      const cmdArgs = ['pack', '--ignore-scripts', '.', ...extraArgs]
      const bundledNpmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
      const npmCli = process.env.npm_execpath && existsSync(process.env.npm_execpath)
        ? process.env.npm_execpath
        : existsSync(bundledNpmCli)
          ? bundledNpmCli
          : undefined
      const env = { ...process.env }
      delete env.npm_config_dry_run
      env.npm_config_cache = process.env.npm_config_cache ?? cacheDir
      env.npm_config_update_notifier = 'false'
      env.npm_config_dry_run = isDryMode ? 'true' : 'false'

      if (npmCli) {
        return execFileSync(process.execPath, [npmCli, ...cmdArgs], {
          cwd: stageDir,
          encoding: 'utf8',
          env,
          stdio: ['ignore', 'pipe', 'inherit'],
        })
      }
      return execFileSync('npm', cmdArgs, {
        cwd: stageDir,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        env,
        stdio: ['ignore', 'pipe', 'inherit'],
      })
    }

    const verifyJsonOutput = (rawJson) => {
      const parsed = JSON.parse(rawJson)
      if (!Array.isArray(parsed) || parsed.length !== 1) {
        throw new Error(`Expected exactly one packed archive entry, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}`)
      }
      const archive = parsed[0]
      if (Array.isArray(archive?.bundled) && archive.bundled.length > 0) {
        throw new Error(`Unexpected bundled dependencies in npm archive: ${archive.bundled.join(', ')}`)
      }
      const packedNames = (archive?.files ?? []).map((item) => item.path)
      const packedSet = new Set(packedNames)
      for (const requiredFile of REQUIRED_PACKAGE_FILES) {
        if (!packedSet.has(requiredFile)) {
          throw new Error(`npm pack metadata is missing required runtime entry: ${requiredFile}`)
        }
      }
      assertSafeArchiveEntries(packedNames, {
        allowPublicReadme: staged.allowPublicReadme,
        requireReadme: !staged.privateCheckout || parsedArgs.publicReadmePath !== undefined,
        stagedReadmeContent: staged.stagedReadmeContent,
        privateReadmeContent,
        stagedSet,
      })
      assertExactFileSet(packedNames, expectedPackageFiles, 'npm pack metadata')
      return archive
    }

    const dryJsonRaw = runNpmPack([...sharedFlags, '--dry-run', '--json'], true)
    verifyJsonOutput(dryJsonRaw)

    if (parsedArgs.dryRun) {
      if (parsedArgs.json) return dryJsonRaw
      return runNpmPack([...sharedFlags, '--dry-run'], true)
    }

    const packOutDir = join(tempRoot, 'pack-out')
    mkdirSync(packOutDir, { recursive: true })
    const realJsonRaw = runNpmPack([
      ...sharedFlags,
      '--dry-run=false',
      '--pack-destination',
      packOutDir,
      '--json',
    ], false)
    const realArchive = verifyJsonOutput(realJsonRaw)
    const filename = realArchive?.filename
    if (
      typeof filename !== 'string' ||
      !filename.endsWith('.tgz') ||
      filename.includes('/') ||
      filename.includes('\\')
    ) {
      throw new Error(`Invalid packed archive filename: ${String(filename)}`)
    }
    const stagedTgzPath = join(packOutDir, filename)
    if (!existsSync(stagedTgzPath) || !statSync(stagedTgzPath).isFile() || statSync(stagedTgzPath).size === 0) {
      throw new Error(`Packed archive missing or empty on disk: ${stagedTgzPath}`)
    }
    const inspected = inspectTarGzArchive(stagedTgzPath)
    const actualEntries = inspected.entries
    const expectedPaths = (realArchive?.files ?? []).map((item) => item.path)
    if (actualEntries.length !== expectedPaths.length) {
      throw new Error(`Actual .tgz entry count (${actualEntries.length}) mismatches npm pack metadata (${expectedPaths.length})`)
    }
    const actualSet = new Set(actualEntries)
    const expectedSet = new Set(expectedPaths)
    for (const expectedPath of expectedPaths) {
      if (!actualSet.has(expectedPath)) {
        throw new Error(`Actual .tgz is missing expected archive entry: ${expectedPath}`)
      }
    }
    for (const actualPath of actualEntries) {
      if (!expectedSet.has(actualPath)) {
        throw new Error(`Actual .tgz contains unexpected entry absent from npm pack metadata: ${actualPath}`)
      }
    }
    for (const requiredFile of REQUIRED_PACKAGE_FILES) {
      if (!actualSet.has(requiredFile)) {
        throw new Error(`Actual .tgz is missing required runtime entry: ${requiredFile}`)
      }
    }
    assertSafeArchiveDirectories(inspected.dirs, {
      allowPublicReadme: staged.allowPublicReadme,
      stagedSet,
    })
    let verifiedArchivedReadmeContent
    if (staged.allowPublicReadme) {
      const archivedReadme = inspected.fileContents.get('README.md')
      verifyPublicReadmeBytes(archivedReadme, staged.stagedReadmeBytes)
      verifiedArchivedReadmeContent = archivedReadme.toString('utf8')
    }
    assertSafeArchiveEntries(actualEntries, {
      allowPublicReadme: staged.allowPublicReadme,
      requireReadme: !staged.privateCheckout || parsedArgs.publicReadmePath !== undefined,
      stagedReadmeContent: verifiedArchivedReadmeContent ?? staged.stagedReadmeContent,
      privateReadmeContent,
      stagedSet,
    })
    assertExactFileSet(actualEntries, expectedPackageFiles, 'Actual .tgz archive')
    assertArchivedFilesMatchStaged(inspected.fileContents, stageDir, stagedSet)

    mkdirSync(resolvedDestination, { recursive: true })
    const finalTgzPath = join(resolvedDestination, filename)
    cpSync(stagedTgzPath, finalTgzPath)

    if (parsedArgs.json) return realJsonRaw
    if (parsedArgs.quiet) return ''
    return `${filename}\n`
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = runLocalPack(process.argv.slice(2))
  if (output) process.stdout.write(output)
}
