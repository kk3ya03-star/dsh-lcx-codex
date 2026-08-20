import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensurePrivateFileAcl } from './private-file.js'

const LOCK_STALE_MS = 30 * 1000
const LOCK_WAIT_MS = 5 * 1000

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
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
    const [pidText, startedAtText] = text.split(/\r?\n/u)
    const pid = Number(pidText)
    const startedAt = Number(startedAtText)
    const age = Date.now() - Math.max(info.mtimeMs, Number.isFinite(startedAt) ? startedAt : 0)
    if (age <= LOCK_STALE_MS || processAlive(pid)) return undefined
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

function signature(file) {
  try {
    const value = statSync(file)
    return `${value.mtimeMs}:${value.ctimeMs}:${value.size}`
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

export class AtomicWebSearchStore {
  constructor(file, { empty, validate, corruptCode, writeCode, maxBytes = 2 * 1024 * 1024 }) {
    this.file = file
    this.lockFile = `${file}.lock`
    this.empty = empty
    this.validate = validate
    this.corruptCode = corruptCode
    this.writeCode = writeCode
    this.maxBytes = maxBytes
    this.fileSignature = undefined
    this.data = this.load()
  }

  error(message, code, cause) {
    const error = new Error(message, cause === undefined ? undefined : { cause })
    error.code = code
    return error
  }

  load(repairAcl = true) {
    try {
      const text = readFileSync(this.file, 'utf8')
      if (Buffer.byteLength(text, 'utf8') > this.maxBytes) throw this.error(`Web Search store exceeds ${this.maxBytes} bytes`, this.corruptCode)
      const parsed = JSON.parse(text)
      if (!this.validate(parsed)) throw this.error(`Invalid Web Search store ${this.file}`, this.corruptCode)
      this.fileSignature = signature(this.file)
      return parsed
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.fileSignature = undefined
        return this.empty()
      }
      if (repairAcl && ['EACCES', 'EPERM'].includes(error?.code) && ensurePrivateFileAcl(this.file)) {
        return this.load(false)
      }
      if (error?.code === this.corruptCode) throw error
      throw this.error(`Unable to load Web Search store ${this.file}`, this.corruptCode, error)
    }
  }

  refresh() {
    if (signature(this.file) !== this.fileSignature) this.data = this.load()
  }

  update(mutator) {
    mkdirSync(dirname(this.file), { recursive: true })
    ensurePrivateFileAcl(dirname(this.file))
    const release = this.acquireLock()
    try {
      const current = this.load()
      const next = mutator(structuredClone(current))
      this.saveUnlocked(next)
      return structuredClone(next)
    } finally {
      release()
    }
  }

  acquireLock() {
    const started = Date.now()
    while (Date.now() - started <= LOCK_WAIT_MS) {
      const token = randomUUID()
      const lockText = `${process.pid}\n${Date.now()}\n${token}\n`
      let fd
      let created = false
      try {
        fd = openSync(this.lockFile, 'wx', 0o600)
        created = true
        if (!ensurePrivateFileAcl(this.lockFile)) throw new Error(`Unable to apply private ACL to Web Search store lock ${this.lockFile}`)
        writeFileSync(fd, lockText, { encoding: 'utf8' })
        fsyncSync(fd)
        closeSync(fd)
        fd = undefined
        return () => {
          try {
            if (readFileSync(this.lockFile, 'utf8') === lockText) unlinkSync(this.lockFile)
          } catch {
            // A crashed owner may have left a lock that was recovered by another writer.
          }
        }
      } catch (error) {
        if (fd !== undefined) {
          try { closeSync(fd) } catch {}
        }
        if (created) {
          try { unlinkSync(this.lockFile) } catch {}
        }
        if (error?.code !== 'EEXIST') throw this.error(`Unable to acquire Web Search store lock ${this.lockFile}`, this.writeCode, error)
        if (unlinkLockIfUnchanged(this.lockFile, staleLockSnapshot(this.lockFile))) continue
        sleepSync(10)
      }
    }
    throw this.error(`Timed out acquiring Web Search store lock ${this.lockFile}`, this.writeCode)
  }

  saveUnlocked(data) {
    if (!this.validate(data)) throw this.error(`Refusing to write invalid Web Search store ${this.file}`, this.writeCode)
    const serialized = JSON.stringify(data, null, 2)
    if (Buffer.byteLength(serialized, 'utf8') > this.maxBytes) throw this.error(`Web Search store exceeds ${this.maxBytes} bytes`, this.writeCode)
    const directory = dirname(this.file)
    const temporary = join(directory, `.${basename(this.file)}.${randomUUID()}.tmp`)
    let fd
    try {
      fd = openSync(temporary, 'wx', 0o600)
      if (!ensurePrivateFileAcl(temporary)) throw new Error(`Unable to apply private ACL to Web Search store temporary file ${temporary}`)
      writeFileSync(fd, serialized, { encoding: 'utf8' })
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      renameSync(temporary, this.file)
      ensurePrivateFileAcl(this.file)
      this.fileSignature = signature(this.file)
      this.data = data
    } catch (error) {
      if (fd !== undefined) {
        try { closeSync(fd) } catch {}
      }
      try { unlinkSync(temporary) } catch {}
      throw this.error(`Unable to atomically write Web Search store ${this.file}`, this.writeCode, error)
    }
  }
}
