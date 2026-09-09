import { createHash } from "node:crypto";
export const GROK_NATIVE_SERVER_TOOL_TYPES = new Set([
    "web_search_call",
    "x_search_call",
]);
const GROK_EXCLUDED_SEARCH_FUNCTIONS = new Set([
    "web_search",
    "websearch_gpt_advanced",
    "websearch_alpha",
]);
const GROK_NATIVE_VISIBLE_ITEM_TYPES = new Set([
    "message",
    "reasoning",
    "function_call",
    "custom_tool_call",
]);
const GROK_NATIVE_REPLAY_MAX_ITEMS = 256;
const GROK_NATIVE_REPLAY_MAX_CHARS = 8 * 1024 * 1024;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function canonicalHeaders(headers) {
    return Object.entries(headers ?? {})
        .map(([name, value]) => [name.toLowerCase(), value])
        .sort(([left], [right]) => left.localeCompare(right));
}
export function grokNativeReplayRouteFingerprint(route) {
    return createHash("sha256")
        .update(JSON.stringify({
        provider: route.provider,
        model: route.model,
        sessionId: route.sessionId,
        baseURL: route.baseURL.trim().replace(/\/+$/u, ""),
        apiKeyEnv: route.apiKeyEnv,
        headers: canonicalHeaders(route.headers),
    }), "utf8")
        .digest("hex");
}
export function grokNativeSearchEnabled(state) {
    return state.web || state.x;
}
export function grokVisibleFunctionTools(tools, state = { web: false, x: false }) {
    return tools?.filter((tool) => !GROK_EXCLUDED_SEARCH_FUNCTIONS.has(tool.name) &&
        !(state.x && tool.name === "x_search"));
}
export function grokWireTools(tools, state) {
    const nativeTypes = new Set(["web_search", "x_search"]);
    const result = (tools ?? [])
        .filter((tool) => {
        if (!isRecord(tool))
            return true;
        if (nativeTypes.has(String(tool.type ?? "")))
            return false;
        return !(state.x && tool.type === "function" && tool.name === "x_search");
    })
        .map((tool) => structuredClone(tool))
        .filter(isRecord);
    if (state.web)
        result.push({ type: "web_search" });
    if (state.x)
        result.push({ type: "x_search" });
    return result;
}
function validVisibleItem(item) {
    if (item.type === "message")
        return typeof item.id === "string" && item.role === "assistant" &&
            Array.isArray(item.content);
    if (item.type === "reasoning")
        return typeof item.id === "string" && Array.isArray(item.summary);
    if (item.type === "function_call")
        return typeof item.id === "string" && typeof item.call_id === "string" &&
            typeof item.name === "string" && typeof item.arguments === "string";
    if (item.type === "custom_tool_call")
        return typeof item.id === "string" && typeof item.call_id === "string" &&
            typeof item.name === "string" && typeof item.input === "string";
    return false;
}
function readGrokNativeReplayEnvelope(value, route) {
    if (!isRecord(value) ||
        value.kind !== "xai-responses-native-search" ||
        value.version !== 3)
        return undefined;
    if (value.provider !== route.provider ||
        value.model !== route.model ||
        value.sourceSessionId !== route.sessionId ||
        value.routeAuthorityFingerprint !== grokNativeReplayRouteFingerprint(route) ||
        !Array.isArray(value.output) ||
        value.output.length === 0 ||
        value.output.length > GROK_NATIVE_REPLAY_MAX_ITEMS)
        return undefined;
    let encoded;
    try {
        encoded = JSON.stringify(value.output);
    }
    catch {
        return undefined;
    }
    if (encoded === undefined || encoded.length > GROK_NATIVE_REPLAY_MAX_CHARS)
        return undefined;
    const output = [];
    const itemKinds = new Map();
    const callIds = new Set();
    for (const candidate of value.output) {
        if (!isRecord(candidate) || typeof candidate.type !== "string")
            return undefined;
        const item = candidate;
        if (GROK_NATIVE_SERVER_TOOL_TYPES.has(item.type)) {
            if (typeof item.id !== "string" || item.id.length === 0)
                return undefined;
        }
        else if (!GROK_NATIVE_VISIBLE_ITEM_TYPES.has(item.type) || !validVisibleItem(item)) {
            return undefined;
        }
        if (typeof item.id === "string") {
            const previousKind = itemKinds.get(item.id);
            // Compatible Grok gateways can repeat a reasoning ID around server tools.
            // These are ordered opaque items, never executable client calls.
            if (previousKind !== undefined &&
                !(previousKind === "reasoning" && item.type === "reasoning"))
                return undefined;
            itemKinds.set(item.id, item.type);
        }
        if (item.type === "function_call" || item.type === "custom_tool_call") {
            const callId = String(item.call_id);
            if (callIds.has(callId))
                return undefined;
            callIds.add(callId);
        }
        output.push(structuredClone(item));
    }
    if (output.length === 0)
        return undefined;
    return {
        kind: "xai-responses-native-search",
        version: 3,
        provider: route.provider,
        model: route.model,
        sourceSessionId: route.sessionId,
        routeAuthorityFingerprint: grokNativeReplayRouteFingerprint(route),
        output,
    };
}
export function createGrokNativeReplayEnvelope(output, route) {
    if (!route || !Array.isArray(output))
        return undefined;
    return readGrokNativeReplayEnvelope({
        kind: "xai-responses-native-search",
        version: 3,
        provider: route.provider,
        model: route.model,
        sourceSessionId: route.sessionId,
        routeAuthorityFingerprint: grokNativeReplayRouteFingerprint(route),
        output,
    }, route);
}
function itemText(item) {
    if (item.type === "message")
        return (Array.isArray(item.content) ? item.content : [])
            .map((part) => isRecord(part) ? String(part.text ?? part.refusal ?? "") : "")
            .join("");
    if (item.type === "reasoning") {
        const parts = Array.isArray(item.summary) && item.summary.length > 0
            ? item.summary
            : Array.isArray(item.content) ? item.content : [];
        return parts.map((part) => isRecord(part) ? String(part.text ?? "") : "").join("\n\n");
    }
    return "";
}
function visibleItemMatchesBlock(item, block) {
    if (item.type === "message")
        return block.type === "text" && block.text === itemText(item);
    if (item.type === "reasoning")
        return block.type === "reasoning" && block.text === itemText(item);
    if (item.type === "function_call")
        return block.type === "tool-call" && block.id === `${String(item.call_id)}|${String(item.id)}` &&
            block.name === item.name && block.arguments === item.arguments;
    if (item.type === "custom_tool_call")
        return block.type === "tool-call" && block.id === `${String(item.call_id)}|${String(item.id)}` &&
            block.name === item.name;
    return false;
}
function visibleItemMatchesInput(item, candidate) {
    if (!isRecord(candidate) || candidate.type !== item.type)
        return false;
    if (candidate.id !== item.id)
        return false;
    if (item.type === "function_call" || item.type === "custom_tool_call")
        return candidate.call_id === item.call_id;
    return true;
}
function replayForMessage(message, route) {
    if (message.role !== "assistant" || message.source.kind !== "model")
        return undefined;
    if (message.source.provider !== route.provider || message.source.model !== route.model)
        return undefined;
    const replayState = message.source.replayState;
    if (!isRecord(replayState))
        return undefined;
    const envelope = readGrokNativeReplayEnvelope(replayState.grokNative, route);
    if (!envelope)
        return undefined;
    const visible = envelope.output.filter((item) => !GROK_NATIVE_SERVER_TOOL_TYPES.has(item.type));
    if (visible.length === 0)
        return undefined;
    const reasoningCounts = new Map();
    for (const item of visible)
        if (item.type === "reasoning")
            reasoningCounts.set(String(item.id), (reasoningCounts.get(String(item.id)) ?? 0) + 1);
    const anchors = [];
    let blockIndex = 0;
    for (const item of visible) {
        const block = message.content[blockIndex];
        if (isRecord(block) && visibleItemMatchesBlock(item, block)) {
            anchors.push(item);
            blockIndex += 1;
        }
        else if (!(item.type === "reasoning" &&
            (!itemText(item).trim() || (reasoningCounts.get(String(item.id)) ?? 0) > 1))) {
            return undefined;
        }
    }
    // Empty Grok reasoning has no UI block. Pi can coalesce repeated reasoning IDs
    // in terminal-only gateway responses; every actual DSH-visible block must still match.
    if (anchors.length === 0)
        return undefined;
    if (blockIndex !== message.content.length)
        return undefined;
    return { envelope, visible: anchors };
}
export function restoreGrokNativeReplay(input, messages, route) {
    const restored = structuredClone(input);
    if (!route)
        return restored;
    let cursor = 0;
    for (const message of messages) {
        const replay = replayForMessage(message, route);
        if (!replay)
            continue;
        const { envelope, visible } = replay;
        const replacedLength = visible.length;
        let start = -1;
        for (let index = cursor; index <= restored.length - replacedLength; index += 1) {
            if (visible.every((item, offset) => visibleItemMatchesInput(item, restored[index + offset]))) {
                start = index;
                break;
            }
        }
        if (start < 0)
            continue;
        restored.splice(start, replacedLength, ...structuredClone(envelope.output));
        cursor = start + envelope.output.length;
    }
    return restored;
}
