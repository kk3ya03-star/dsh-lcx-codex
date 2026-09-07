export declare class JsonStore<T> {
    readonly file: string;
    readonly empty: () => T;
    readonly validate: (data: unknown) => data is T;
    readonly corruptCode: string;
    data: T;
    constructor(file: string, empty: () => T, validate: (data: unknown) => data is T, corruptCode?: string);
    refresh(): void;
    update(mutator: (current: T) => T): void;
}
