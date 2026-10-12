import { buildCopilotDynamicHeaders, hasCopilotVisionInput, withOpenCodeSessionHeader, } from "./pi-responses-runtime.js";
/** The user / assistant / toolResult view of a DSH request that Pi's Copilot helpers read. */
function piMessages(messages) {
    const result = [];
    for (const message of messages) {
        if (message.role === "user" || message.role === "assistant")
            result.push({ role: message.role, content: message.content });
        else if (message.role === "tool")
            result.push({ role: "toolResult", content: message.content });
    }
    return result;
}
/** GitHub Copilot: `X-Initiator`, `Openai-Intent` and, when images are sent, `Copilot-Vision-Request`. */
export function providerDynamicHeaders(provider, messages) {
    if (provider !== "github-copilot")
        return {};
    const pi = piMessages(messages);
    return buildCopilotDynamicHeaders({ messages: pi, hasImages: hasCopilotVisionInput(pi) });
}
/** OpenCode Zen / Go: the per-conversation routing header Pi adds before dispatch. */
export function providerSessionHeaders(provider, sessionId) {
    if ((provider !== "opencode" && provider !== "opencode-go") || sessionId === undefined)
        return {};
    let captured = {};
    const capture = (_model, _context, options) => {
        captured = { ...options?.headers };
        return undefined;
    };
    withOpenCodeSessionHeader({ stream: capture, streamSimple: capture }).stream(undefined, undefined, { sessionId });
    return captured;
}
