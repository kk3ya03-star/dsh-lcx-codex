import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'

export class JsonStore {
  constructor(file, empty, validate, corruptCode = 'LCX_STORE_CORRUPT') {
    this.file = file
    this.empty = empty
    this.validate = validate
    this.corruptCode = corruptCode
    this.data = empty()
    this.refresh()
  }
  refresh() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!this.validate(parsed)) throw new Error('invalid store')
      this.data = parsed
    } catch (error) {
      if (error?.code === 'ENOENT') { this.data = this.empty(); return }
      const wrapped = new Error(`Invalid LCX store ${this.file}`, { cause: error }); wrapped.code = this.corruptCode; throw wrapped
    }
  }
  update(mutator) {
    this.refresh()
    const next = mutator(structuredClone(this.data))
    if (!this.validate(next)) throw new Error(`Refusing to write invalid LCX store ${this.file}`)
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    try { chmodSync(tmp, 0o600) } catch {}
    renameSync(tmp, this.file)
    this.data = next
  }
}
