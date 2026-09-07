import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

type CodedError = Error & { code?: unknown };

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error
    ? (error as CodedError).code
    : undefined;
}

export class JsonStore<T> {
  readonly file: string;
  readonly empty: () => T;
  readonly validate: (data: unknown) => data is T;
  readonly corruptCode: string;
  data: T;

  constructor(
    file: string,
    empty: () => T,
    validate: (data: unknown) => data is T,
    corruptCode = "LCX_STORE_CORRUPT",
  ) {
    this.file = file;
    this.empty = empty;
    this.validate = validate;
    this.corruptCode = corruptCode;
    this.data = empty();
    this.refresh();
  }

  refresh(): void {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (!this.validate(parsed)) throw new Error("invalid store");
      this.data = parsed;
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        this.data = this.empty();
        return;
      }
      const wrapped: Error & { code: string } = Object.assign(
        new Error(`Invalid LCX store ${this.file}`, { cause: error }),
        { code: this.corruptCode },
      );
      throw wrapped;
    }
  }

  update(mutator: (current: T) => T): void {
    this.refresh();
    const next = mutator(structuredClone(this.data));
    if (!this.validate(next))
      throw new Error(`Refusing to write invalid LCX store ${this.file}`);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch {}
    renameSync(tmp, this.file);
    this.data = next;
  }
}
