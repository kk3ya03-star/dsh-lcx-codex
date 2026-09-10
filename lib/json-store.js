import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync, } from "node:fs";
import { dirname } from "node:path";
function errorCode(error) {
    return error instanceof Error && "code" in error
        ? error.code
        : undefined;
}
export class JsonStore {
    file;
    empty;
    validate;
    corruptCode;
    migrate;
    data;
    constructor(file, empty, validate, corruptCode = "LCX_STORE_CORRUPT", migrate) {
        this.file = file;
        this.empty = empty;
        this.validate = validate;
        this.corruptCode = corruptCode;
        this.migrate = migrate;
        this.data = empty();
        this.refresh();
    }
    refresh() {
        try {
            const parsed = JSON.parse(readFileSync(this.file, "utf8"));
            if (this.validate(parsed))
                this.data = parsed;
            else {
                const migrated = this.migrate?.(parsed);
                if (migrated === undefined || !this.validate(migrated))
                    throw new Error("invalid store");
                this.data = migrated;
            }
        }
        catch (error) {
            if (errorCode(error) === "ENOENT") {
                this.data = this.empty();
                return;
            }
            const wrapped = Object.assign(new Error(`Invalid LCX store ${this.file}`, { cause: error }), { code: this.corruptCode });
            throw wrapped;
        }
    }
    update(mutator) {
        this.refresh();
        const next = mutator(structuredClone(this.data));
        if (!this.validate(next))
            throw new Error(`Refusing to write invalid LCX store ${this.file}`);
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        try {
            chmodSync(tmp, 0o600);
        }
        catch { }
        renameSync(tmp, this.file);
        this.data = next;
    }
}
