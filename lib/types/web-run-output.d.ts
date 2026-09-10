export interface WebRunLink {
    id: number;
    label: string;
    domain?: string;
    url?: string;
}
export interface WebRunLine {
    text: string;
    heading?: number;
    line?: number;
    page?: number;
    pageEnd?: number;
}
export interface WebRunBlock {
    title?: string;
    url?: string;
    references: string[];
    links: WebRunLink[];
    metadata: string[];
    lines: WebRunLine[];
}
export declare function parseWebRunOutput(output: string): WebRunBlock[];
export declare function outputLineRange(blocks: WebRunBlock[]): {
    first: number;
    last: number;
} | undefined;
export declare function outputDomains(blocks: WebRunBlock[]): string[];
export declare function outputLinks(blocks: WebRunBlock[]): WebRunLink[];
export declare function mergeWebRunLinks(base: WebRunLink[], extra: WebRunLink[]): WebRunLink[];
export declare function outputPdfRefs(blocks: WebRunBlock[]): string[];
export declare function blockPlainText(block: Pick<WebRunBlock, "lines">): string;
