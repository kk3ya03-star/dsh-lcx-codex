import type { ClientModuleLoaderTarget } from "@deepseek-ai/dsh-client-modules/client";
import { type SearchMediaItem } from "./search-media.js";
type SearchMediaData = {
    readonly items: readonly SearchMediaItem[];
    readonly provider: string;
    readonly model: string;
};
declare module "@deepseek-ai/dsh-client-ui-chat/client" {
    interface ChatNodeDataMap {
        "lcx-search-media": SearchMediaData;
    }
}
declare global {
    interface Window {
        __ModuleLoader__: Pick<ClientModuleLoaderTarget, "load">;
    }
}
export {};
