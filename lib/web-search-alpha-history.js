const ASSISTANT_CONTEXT_TOKEN_LIMIT = 1_000;
const APPROX_BYTES_PER_TOKEN = 4;
function textBlocks(message) {
    const type = message.role === "user" ? "input_text" : "output_text";
    return message.content.flatMap((block) => block.type === "text" ? [{ type, text: block.text }] : []);
}
function approxTokens(text) {
    return Math.ceil(Buffer.byteLength(text, "utf8") / APPROX_BYTES_PER_TOKEN);
}
// Codex's UTF-8 middle truncation for one over-budget assistant text block.
function truncateAssistantText(text, tokens) {
    const bytes = Buffer.byteLength(text, "utf8");
    const budget = tokens * APPROX_BYTES_PER_TOKEN;
    if (bytes <= budget)
        return text;
    const leftBudget = Math.floor(budget / 2);
    const rightBudget = budget - leftBudget;
    let prefix = "";
    let suffix = "";
    let consumed = 0;
    for (const char of text) {
        const next = consumed + Buffer.byteLength(char, "utf8");
        if (next <= leftBudget)
            prefix += char;
        if (consumed >= bytes - rightBudget)
            suffix += char;
        consumed = next;
    }
    return `${prefix}…${Math.ceil((bytes - budget) / APPROX_BYTES_PER_TOKEN)} tokens truncated…${suffix}`;
}
/** Codex recent_input on the canonical DSH message surface. */
export function recentAlphaInput(messages) {
    const users = messages.flatMap((message, index) => message.role === "user" && message.source.kind === "user" && textBlocks(message).length ? [index] : []);
    if (!users.length)
        return undefined;
    const start = users.at(-2) ?? users.at(-1);
    const end = users.at(-1);
    let assistantTokens = ASSISTANT_CONTEXT_TOKEN_LIMIT;
    const items = [];
    for (let index = start; index <= end; index++) {
        const message = messages[index];
        if (message.role === "user" && message.source.kind === "user") {
            const content = textBlocks(message);
            if (content.length)
                items.push({ type: "message", role: "user", content });
        }
        else if (message.role === "assistant" && assistantTokens > 0) {
            const content = [];
            for (const block of textBlocks(message)) {
                if (assistantTokens === 0)
                    break;
                const cost = approxTokens(block.text);
                content.push({ type: "output_text", text: cost <= assistantTokens
                        ? block.text : truncateAssistantText(block.text, assistantTokens) });
                assistantTokens = Math.max(0, assistantTokens - cost);
            }
            if (content.length)
                items.push({ type: "message", role: "assistant", content });
        }
    }
    return items.length ? items : undefined;
}
