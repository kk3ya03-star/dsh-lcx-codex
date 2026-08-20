import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PORTABLE_HISTORY_BYTE_BUDGET } from './compact.js'
import { ensurePrivateFileAcl } from './private-file.js'

export const CHECKPOINT_V3_VERSION = 3
export const CHECKPOINT_V3_MAX_RECORDS = 256
export const CHECKPOINT_V3_MAX_BYTES = 16 * 1024 * 1024

const LOCK_STALE_MS = 30 * 1000
const LOCK_WAIT_MS = 5 * 1000
const TEMP_STALE_MS = 60 * 60 * 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class CheckpointV3Error extends Error {
  constructor(message, code, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'CheckpointV3Error'
    this.code = code
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function bytes(value, pretty = false) {
  return Buffer.byteLength(JSON.stringify(value, null, pretty ? 2 : undefined), 'utf8')
}

function validImageAttachmentRef(ref) {
  return isObject(ref) && /^sha256:[a-f0-9]{64}$/iu.test(String(ref.attachmentId ?? '')) &&
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(ref.mediaType) &&
    Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && Number.isSafeInteger(ref.width) && ref.width > 0 &&
    Number.isSafeInteger(ref.height) && ref.height > 0 && (ref.name === undefined || typeof ref.name === 'string')
}

function validContentPart(part) {
  if (!isObject(part) || typeof part.type !== 'string' || part.type.length === 0 || part.type === 'input_image') return false
  if (part.type === 'dsh_image_attachment') return validImageAttachmentRef(part.attachment)
  if ((part.type === 'input_text' || part.type === 'output_text' || part.type === 'summary_text' || part.type === 'refusal') && typeof part.text !== 'string') return false
  return true
}

function validMessageItem(item) {
  return typeof item.role === 'string' && item.role.length > 0 && Array.isArray(item.content) && item.content.every(validContentPart)
}

function validPortableMessageItem(item) {
  return typeof item.role === 'string' && item.role.length > 0 && Array.isArray(item.content) &&
    item.content.every(validContentPart)
}

function validNativeOutputItem(item) {
  if (!isObject(item) || typeof item.type !== 'string' || item.type.length === 0) return false
  if (item.id !== undefined && (typeof item.id !== 'string' || item.id.length === 0)) return false
  if (item.type === 'message') return validMessageItem(item)
  if (item.type === 'compaction') return validNativeCompaction(item)
  if (item.type === 'function_call') {
    return typeof item.call_id === 'string' && item.call_id.length > 0 &&
      typeof item.name === 'string' && item.name.length > 0 &&
      typeof item.arguments === 'string'
  }
  if (item.type === 'function_call_output') {
    return typeof item.call_id === 'string' && item.call_id.length > 0 &&
      (typeof item.output === 'string' || (Array.isArray(item.output) && item.output.every(validContentPart)))
  }
  if (item.type === 'reasoning') {
    return (item.encrypted_content === undefined || typeof item.encrypted_content === 'string') &&
      (item.content === undefined || (Array.isArray(item.content) && item.content.every(validContentPart))) &&
      (item.summary === undefined || (Array.isArray(item.summary) && item.summary.every(validContentPart)))
  }
  return true
}

function validPortableItem(item) {
  if (!isObject(item) || typeof item.type !== 'string' || item.type.length === 0) return false
  if (item.type === 'compaction' || item.type === 'context_compaction' || item.type === 'compaction_trigger') return false
  if (item.type.startsWith('response.')) return false
  if (Object.prototype.hasOwnProperty.call(item, 'encrypted_content')) return false
  if (item.id !== undefined && (typeof item.id !== 'string' || item.id.length === 0)) return false
  if (item.type === 'message') return validPortableMessageItem(item)
  if (item.type === 'function_call') {
    return typeof item.call_id === 'string' && item.call_id.length > 0 &&
      typeof item.name === 'string' && item.name.length > 0 &&
      typeof item.arguments === 'string'
  }
  if (item.type === 'function_call_output') {
    return typeof item.call_id === 'string' && item.call_id.length > 0 &&
      (typeof item.output === 'string' || (Array.isArray(item.output) && item.output.every(validContentPart)))
  }
  return true
}

function validNativeCompaction(item) {
  return isObject(item) && item.type === 'compaction' &&
    typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0
}

function validateItemCollection(items, validator, strictPairing) {
  const ids = new Set()
  const callIndexes = new Map()
  const outputIndexes = new Map()
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!validator(item)) return false
    if (item.id !== undefined) {
      if (ids.has(item.id)) return false
      ids.add(item.id)
    }
    if (item.type === 'function_call') {
      if (callIndexes.has(item.call_id)) return false
      callIndexes.set(item.call_id, index)
    }
    if (item.type === 'function_call_output') {
      if (outputIndexes.has(item.call_id)) return false
      outputIndexes.set(item.call_id, index)
    }
  }
  if (strictPairing) {
    if (callIndexes.size !== outputIndexes.size) return false
    for (const [callId, callIndex] of callIndexes) {
      if (!outputIndexes.has(callId) || callIndex >= outputIndexes.get(callId)) return false
    }
  }
  return true
}

function validRecord(record, { strictPortablePairing = false } = {}) {
  if (!isObject(record) || record.version !== CHECKPOINT_V3_VERSION ||
    typeof record.checkpointId !== 'string' || record.checkpointId.length < 8 ||
    typeof record.lineageId !== 'string' || record.lineageId.length === 0 ||
    typeof record.sourceSessionId !== 'string' || record.sourceSessionId.length === 0 ||
    record.sourceSessionId !== record.lineageId ||
    (record.sourceBranchId !== undefined && (typeof record.sourceBranchId !== 'string' || record.sourceBranchId.length === 0)) ||
    (record.parentCheckpointId !== undefined && (typeof record.parentCheckpointId !== 'string' || !UUID_PATTERN.test(record.parentCheckpointId))) ||
    (record.transport !== undefined && typeof record.transport !== 'string') ||
    typeof record.provider !== 'string' || record.provider.length === 0 ||
    typeof record.model !== 'string' || record.model.length === 0 ||
    typeof record.modelKey !== 'string' || record.modelKey !== `${record.provider}:${record.model}` ||
    typeof record.baseURLFingerprint !== 'string' || record.baseURLFingerprint.length === 0 ||
    typeof record.routeFingerprint !== 'string' || record.routeFingerprint.length === 0 ||
    !Array.isArray(record.nativeOutput) || record.nativeOutput.length === 0 ||
    !validNativeCompaction(record.nativeCompaction) ||
    !Array.isArray(record.portableHistory) ||
    typeof record.portableSummary !== 'string' ||
    (record.portableImageCount !== undefined && (!Number.isSafeInteger(record.portableImageCount) || record.portableImageCount < 0)) ||
    !Number.isFinite(record.createdAt)) return false

  const nativeCompactions = record.nativeOutput.filter((item) => isObject(item) && item.type === 'compaction')
  if (nativeCompactions.length !== 1 ||
    nativeCompactions[0].encrypted_content !== record.nativeCompaction.encrypted_content) return false
  if (!validateItemCollection(record.nativeOutput, validNativeOutputItem, true)) return false
  if (!validateItemCollection(record.portableHistory, validPortableItem, strictPortablePairing)) return false
  return bytes(record.nativeOutput) <= PORTABLE_HISTORY_BYTE_BUDGET &&
    bytes(record.portableHistory) <= PORTABLE_HISTORY_BYTE_BUDGET &&
    bytes(record.portableSummary) <= 16 * 1024
}

function emptyData() {
  return { version: CHECKPOINT_V3_VERSION, checkpoints: {} }
}

function normalizedLimits(options = {}) {
  const maxRecords = options.maxRecords ?? options.maxRecordCount ?? CHECKPOINT_V3_MAX_RECORDS
  const maxBytes = options.maxBytes ?? options.maxTotalBytes ?? CHECKPOINT_V3_MAX_BYTES
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new CheckpointV3Error('Invalid checkpoint v3 store limits', 'LCX_CHECKPOINT_V3_LIMIT_INVALID')
  }
  return { maxRecords, maxBytes }
}

function validateData(parsed, file, limits, { strict = false, strictIds = new Set() } = {}) {
  if (parsed?.version !== CHECKPOINT_V3_VERSION) {
    throw new CheckpointV3Error(`Unsupported checkpoint v3 store in ${file}`, 'LCX_CHECKPOINT_V3_VERSION_UNSUPPORTED')
  }
  if (!isObject(parsed.checkpoints)) {
    throw new CheckpointV3Error(`Invalid checkpoint v3 store in ${file}`, 'LCX_CHECKPOINT_V3_CORRUPT')
  }
  const entries = Object.entries(parsed.checkpoints)
  if (entries.length > limits.maxRecords) {
    throw new CheckpointV3Error(`Checkpoint v3 store exceeds record limit (${entries.length}/${limits.maxRecords})`, 'LCX_CHECKPOINT_V3_LIMIT_EXCEEDED')
  }
  for (const [id, record] of entries) {
    if (id !== record?.checkpointId) {
      throw new CheckpointV3Error(`Checkpoint v3 map key does not match record checkpointId (${id})`, 'LCX_CHECKPOINT_V3_KEY_MISMATCH')
    }
    if (!validRecord(record, { strictPortablePairing: strict || strictIds.has(id) })) {
      throw new CheckpointV3Error(`Invalid checkpoint v3 record ${id} in ${file}`, 'LCX_CHECKPOINT_V3_CORRUPT')
    }
  }
  for (const [id, record] of entries) {
    if (record.parentCheckpointId !== undefined) {
      const parent = parsed.checkpoints[record.parentCheckpointId]
      if (!parent) throw new CheckpointV3Error(`Checkpoint v3 parent ${record.parentCheckpointId} for ${id} is missing`, 'LCX_CHECKPOINT_V3_PARENT_MISSING')
      if (parent.lineageId !== record.lineageId) throw new CheckpointV3Error(`Checkpoint v3 parent ${record.parentCheckpointId} for ${id} has a different lineage`, 'LCX_CHECKPOINT_V3_PARENT_MISMATCH')
    }
  }
  const data = { version: CHECKPOINT_V3_VERSION, checkpoints: parsed.checkpoints }
  if (bytes(data, true) > limits.maxBytes) {
    throw new CheckpointV3Error(`Checkpoint v3 store exceeds byte limit (${bytes(data, true)}/${limits.maxBytes})`, 'LCX_CHECKPOINT_V3_LIMIT_EXCEEDED')
  }
  return data
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function fileSignature(file) {
  try {
    const info = statSync(file)
    return { mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, size: info.size, ino: info.ino }
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function sameFileSignature(left, right) {
  return left?.mtimeMs === right?.mtimeMs && left?.ctimeMs === right?.ctimeMs &&
    left?.size === right?.size && left?.ino === right?.ino
}

function lockMetadata(text) {
  const lines = String(text ?? '').split(/\r?\n/u)
  const pid = Number(lines[0])
  const startedAt = Number(lines[1])
  const token = typeof lines[2] === 'string' && lines[2].length > 0 ? lines[2] : undefined
  return {
    pid: Number.isSafeInteger(pid) && pid > 0 ? pid : undefined,
    startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : undefined,
    token,
  }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function staleLockSnapshot(file) {
  try {
    const info = statSync(file)
    const text = readFileSync(file, 'utf8')
    const metadata = lockMetadata(text)
    const age = Date.now() - Math.max(info.mtimeMs, metadata.startedAt ?? 0)
    if (age <= LOCK_STALE_MS || processAlive(metadata.pid)) return undefined
    return { text, mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return undefined
  }
}

function unlinkLockIfUnchanged(file, snapshot) {
  if (!snapshot) return false
  try {
    const info = statSync(file)
    if (info.mtimeMs !== snapshot.mtimeMs || info.size !== snapshot.size || readFileSync(file, 'utf8') !== snapshot.text) return false
    unlinkSync(file)
    return true
  } catch {
    return false
  }
}

function cleanupStaleTemps(file) {
  const directory = dirname(file)
  const prefix = `.${basename(file)}.`
  let names
  try {
    names = readdirSync(directory)
  } catch {
    return
  }
  const now = Date.now()
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue
    const temporary = join(directory, name)
    try {
      const info = statSync(temporary)
      if (info.isFile() && now - info.mtimeMs > TEMP_STALE_MS) unlinkSync(temporary)
    } catch {
      // A concurrent writer may have removed or replaced the candidate.
    }
  }
}

export class CheckpointV3Store {
  constructor(file, options = {}) {
    this.file = file
    this.lockFile = `${file}.lock`
    this.limits = normalizedLimits(options)
    this.fileSignature = undefined
    this.data = this.load()
  }

  load(options = {}) {
    cleanupStaleTemps(this.file)
    try {
      const data = validateData(JSON.parse(readFileSync(this.file, 'utf8')), this.file, this.limits, options)
      this.fileSignature = fileSignature(this.file)
      return data
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.fileSignature = undefined
        return emptyData()
      }
      if (error instanceof CheckpointV3Error) throw error
      throw new CheckpointV3Error(`Unable to load checkpoint v3 store ${this.file}`, 'LCX_CHECKPOINT_V3_CORRUPT', error)
    }
  }

  refreshIfChanged() {
    const currentSignature = fileSignature(this.file)
    if (!sameFileSignature(currentSignature, this.fileSignature)) this.data = this.load()
  }

  get(id) {
    this.refreshIfChanged()
    return Object.prototype.hasOwnProperty.call(this.data.checkpoints, id) ? this.data.checkpoints[id] : undefined
  }

  has(id) {
    return this.get(id) !== undefined
  }

  put(id, record) {
    if (typeof id !== 'string' || id !== record?.checkpointId) {
      throw new CheckpointV3Error(`Checkpoint v3 map key does not match record checkpointId (${id})`, 'LCX_CHECKPOINT_V3_KEY_MISMATCH')
    }
    if (!validRecord(record, { strictPortablePairing: true })) {
      throw new CheckpointV3Error(`Invalid checkpoint v3 record ${id}`, 'LCX_CHECKPOINT_V3_CORRUPT')
    }
    mkdirSync(dirname(this.file), { recursive: true })
    if (fileSignature(this.file)) ensurePrivateFileAcl(this.file)
    ensurePrivateFileAcl(dirname(this.file))
    const release = this.acquireLock()
    try {
      const latest = this.load()
      const candidate = {
        version: CHECKPOINT_V3_VERSION,
        checkpoints: { ...latest.checkpoints, [id]: structuredClone(record) },
      }
      this.data = validateData(candidate, this.file, this.limits, { strictIds: new Set([id]) })
      this.saveAtomicUnlocked()
    } finally {
      release()
    }
  }

  acquireLock() {
    const started = Date.now()
    while (Date.now() - started <= LOCK_WAIT_MS) {
      let fd
      const token = randomUUID()
      const lockText = `${process.pid}\n${Date.now()}\n${token}\n`
      try {
        fd = openSync(this.lockFile, 'wx', 0o600)
        try {
          writeFileSync(fd, lockText, { encoding: 'utf8' })
          fsyncSync(fd)
        } finally {
          closeSync(fd)
          fd = undefined
        }
        ensurePrivateFileAcl(this.lockFile)
        return () => {
          try {
            const current = readFileSync(this.lockFile, 'utf8')
            if (current === lockText) unlinkSync(this.lockFile)
          } catch {
            // The lock may have been removed by stale recovery after a crash.
          }
        }
      } catch (error) {
        if (fd !== undefined) {
          try { closeSync(fd) } catch {}
        }
        if (error?.code !== 'EEXIST') {
          throw new CheckpointV3Error(`Unable to acquire checkpoint v3 lock ${this.lockFile}`, 'LCX_CHECKPOINT_V3_LOCK_FAILED', error)
        }
        if (unlinkLockIfUnchanged(this.lockFile, staleLockSnapshot(this.lockFile))) continue
        sleepSync(10)
      }
    }
    throw new CheckpointV3Error(`Timed out acquiring checkpoint v3 lock`, 'LCX_CHECKPOINT_V3_LOCK_TIMEOUT')
  }

  saveAtomic(options = {}) {
    mkdirSync(dirname(this.file), { recursive: true })
    if (fileSignature(this.file)) ensurePrivateFileAcl(this.file)
    ensurePrivateFileAcl(dirname(this.file))
    const release = this.acquireLock()
    try {
      const latest = this.load()
      const merged = {
        version: CHECKPOINT_V3_VERSION,
        checkpoints: { ...latest.checkpoints, ...this.data.checkpoints },
      }
      this.data = validateData(merged, this.file, this.limits, { strict: options.strict === true })
      this.saveAtomicUnlocked()
    } finally {
      release()
    }
  }

  saveAtomicUnlocked() {
    cleanupStaleTemps(this.file)
    const directory = dirname(this.file)
    mkdirSync(directory, { recursive: true })
    const temporary = join(directory, `.${basename(this.file)}.${randomUUID()}.tmp`)
    const serialized = JSON.stringify(this.data, null, 2)
    let fd
    try {
      fd = openSync(temporary, 'wx', 0o600)
      // Harden the empty temporary file before it receives checkpoint content.
      if (!ensurePrivateFileAcl(temporary)) {
        throw new Error(`Unable to apply private ACL to checkpoint temporary file ${temporary}`)
      }
      writeFileSync(fd, serialized, { encoding: 'utf8' })
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      try { chmodSync(temporary, 0o600) } catch {
        // Windows may not expose POSIX mode bits; the ACL was applied before writing.
      }
      renameSync(temporary, this.file)
      ensurePrivateFileAcl(this.file)
      this.fileSignature = fileSignature(this.file)
    } catch (error) {
      if (fd !== undefined) {
        try { closeSync(fd) } catch {}
      }
      try { unlinkSync(temporary) } catch {
        // Preserve the original write failure.
      }
      throw new CheckpointV3Error(`Unable to atomically write checkpoint v3 store ${this.file}`, 'LCX_CHECKPOINT_V3_WRITE_FAILED', error)
    }
  }
}
