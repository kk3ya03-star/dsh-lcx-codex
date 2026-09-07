import type { ClientModuleLoaderTarget } from "@deepseek-ai/dsh-client-modules/client";
declare global {
    interface Window {
        __ModuleLoader__: Pick<ClientModuleLoaderTarget, "load">;
    }
}
