// Generated from public @earendil-works/pi-ai@1.5.0 by scripts/build-pi-runtime.mjs. Do not edit.
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/partial-json/dist/options.js
var require_options = __commonJS({
  "node_modules/partial-json/dist/options.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Allow = exports.ALL = exports.COLLECTION = exports.ATOM = exports.SPECIAL = exports.INF = exports._INFINITY = exports.INFINITY = exports.NAN = exports.BOOL = exports.NULL = exports.OBJ = exports.ARR = exports.NUM = exports.STR = void 0;
    exports.STR = 1;
    exports.NUM = 2;
    exports.ARR = 4;
    exports.OBJ = 8;
    exports.NULL = 16;
    exports.BOOL = 32;
    exports.NAN = 64;
    exports.INFINITY = 128;
    exports._INFINITY = 256;
    exports.INF = exports.INFINITY | exports._INFINITY;
    exports.SPECIAL = exports.NULL | exports.BOOL | exports.INF | exports.NAN;
    exports.ATOM = exports.STR | exports.NUM | exports.SPECIAL;
    exports.COLLECTION = exports.ARR | exports.OBJ;
    exports.ALL = exports.ATOM | exports.COLLECTION;
    exports.Allow = { STR: exports.STR, NUM: exports.NUM, ARR: exports.ARR, OBJ: exports.OBJ, NULL: exports.NULL, BOOL: exports.BOOL, NAN: exports.NAN, INFINITY: exports.INFINITY, _INFINITY: exports._INFINITY, INF: exports.INF, SPECIAL: exports.SPECIAL, ATOM: exports.ATOM, COLLECTION: exports.COLLECTION, ALL: exports.ALL };
    exports.default = exports.Allow;
  }
});

// node_modules/partial-json/dist/index.js
var require_dist = __commonJS({
  "node_modules/partial-json/dist/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Allow = exports.MalformedJSON = exports.PartialJSON = exports.parseJSON = exports.parse = void 0;
    var options_1 = require_options();
    Object.defineProperty(exports, "Allow", { enumerable: true, get: function() {
      return options_1.Allow;
    } });
    __exportStar(require_options(), exports);
    var PartialJSON = class extends Error {
    };
    exports.PartialJSON = PartialJSON;
    var MalformedJSON = class extends Error {
    };
    exports.MalformedJSON = MalformedJSON;
    function parseJSON(jsonString, allowPartial = options_1.Allow.ALL) {
      if (typeof jsonString !== "string") {
        throw new TypeError(`expecting str, got ${typeof jsonString}`);
      }
      if (!jsonString.trim()) {
        throw new Error(`${jsonString} is empty`);
      }
      return _parseJSON(jsonString.trim(), allowPartial);
    }
    exports.parseJSON = parseJSON;
    var _parseJSON = (jsonString, allow) => {
      const length = jsonString.length;
      let index = 0;
      const markPartialJSON = (msg) => {
        throw new PartialJSON(`${msg} at position ${index}`);
      };
      const throwMalformedError = (msg) => {
        throw new MalformedJSON(`${msg} at position ${index}`);
      };
      const parseAny = () => {
        skipBlank();
        if (index >= length)
          markPartialJSON("Unexpected end of input");
        if (jsonString[index] === '"')
          return parseStr();
        if (jsonString[index] === "{")
          return parseObj();
        if (jsonString[index] === "[")
          return parseArr();
        if (jsonString.substring(index, index + 4) === "null" || options_1.Allow.NULL & allow && length - index < 4 && "null".startsWith(jsonString.substring(index))) {
          index += 4;
          return null;
        }
        if (jsonString.substring(index, index + 4) === "true" || options_1.Allow.BOOL & allow && length - index < 4 && "true".startsWith(jsonString.substring(index))) {
          index += 4;
          return true;
        }
        if (jsonString.substring(index, index + 5) === "false" || options_1.Allow.BOOL & allow && length - index < 5 && "false".startsWith(jsonString.substring(index))) {
          index += 5;
          return false;
        }
        if (jsonString.substring(index, index + 8) === "Infinity" || options_1.Allow.INFINITY & allow && length - index < 8 && "Infinity".startsWith(jsonString.substring(index))) {
          index += 8;
          return Infinity;
        }
        if (jsonString.substring(index, index + 9) === "-Infinity" || options_1.Allow._INFINITY & allow && 1 < length - index && length - index < 9 && "-Infinity".startsWith(jsonString.substring(index))) {
          index += 9;
          return -Infinity;
        }
        if (jsonString.substring(index, index + 3) === "NaN" || options_1.Allow.NAN & allow && length - index < 3 && "NaN".startsWith(jsonString.substring(index))) {
          index += 3;
          return NaN;
        }
        return parseNum();
      };
      const parseStr = () => {
        const start = index;
        let escape = false;
        index++;
        while (index < length && (jsonString[index] !== '"' || escape && jsonString[index - 1] === "\\")) {
          escape = jsonString[index] === "\\" ? !escape : false;
          index++;
        }
        if (jsonString.charAt(index) == '"') {
          try {
            return JSON.parse(jsonString.substring(start, ++index - Number(escape)));
          } catch (e) {
            throwMalformedError(String(e));
          }
        } else if (options_1.Allow.STR & allow) {
          try {
            return JSON.parse(jsonString.substring(start, index - Number(escape)) + '"');
          } catch (e) {
            return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("\\")) + '"');
          }
        }
        markPartialJSON("Unterminated string literal");
      };
      const parseObj = () => {
        index++;
        skipBlank();
        const obj = {};
        try {
          while (jsonString[index] !== "}") {
            skipBlank();
            if (index >= length && options_1.Allow.OBJ & allow)
              return obj;
            const key = parseStr();
            skipBlank();
            index++;
            try {
              const value = parseAny();
              obj[key] = value;
            } catch (e) {
              if (options_1.Allow.OBJ & allow)
                return obj;
              else
                throw e;
            }
            skipBlank();
            if (jsonString[index] === ",")
              index++;
          }
        } catch (e) {
          if (options_1.Allow.OBJ & allow)
            return obj;
          else
            markPartialJSON("Expected '}' at end of object");
        }
        index++;
        return obj;
      };
      const parseArr = () => {
        index++;
        const arr = [];
        try {
          while (jsonString[index] !== "]") {
            arr.push(parseAny());
            skipBlank();
            if (jsonString[index] === ",") {
              index++;
            }
          }
        } catch (e) {
          if (options_1.Allow.ARR & allow) {
            return arr;
          }
          markPartialJSON("Expected ']' at end of array");
        }
        index++;
        return arr;
      };
      const parseNum = () => {
        if (index === 0) {
          if (jsonString === "-")
            throwMalformedError("Not sure what '-' is");
          try {
            return JSON.parse(jsonString);
          } catch (e) {
            if (options_1.Allow.NUM & allow)
              try {
                return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf("e")));
              } catch (e2) {
              }
            throwMalformedError(String(e));
          }
        }
        const start = index;
        if (jsonString[index] === "-")
          index++;
        while (jsonString[index] && ",]}".indexOf(jsonString[index]) === -1)
          index++;
        if (index == length && !(options_1.Allow.NUM & allow))
          markPartialJSON("Unterminated number literal");
        try {
          return JSON.parse(jsonString.substring(start, index));
        } catch (e) {
          if (jsonString.substring(start, index) === "-")
            markPartialJSON("Not sure what '-' is");
          try {
            return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("e")));
          } catch (e2) {
            throwMalformedError(String(e2));
          }
        }
      };
      const skipBlank = () => {
        while (index < length && " \n\r	".includes(jsonString[index])) {
          index++;
        }
      };
      return parseAny();
    };
    var parse = parseJSON;
    exports.parse = parse;
  }
});

// node_modules/@earendil-works/pi-ai/dist/providers/data/cloudflare-ai-gateway.json
var cloudflare_ai_gateway_default = { "anthropic-messages": { "chat:claude-fable-5": { id: "claude-fable-5", name: "Claude Fable 5", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-fable-5-1": { id: "claude-fable-5-1", name: "Claude Fable 5.1", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-haiku-4-5": { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (latest)", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, contextWindow: 2e5, maxTokens: 64e3, compat: { sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-haiku-5-5": { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, tiers: [{ inputTokensAbove: 1e5, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 }] }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-4-5": { id: "claude-opus-4-5", name: "Claude Opus 4.5 (latest)", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 2e5, maxTokens: 64e3, compat: { sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-4-7": { id: "claude-opus-4-7", name: "Claude Opus 4.7", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-4-8": { id: "claude-opus-4-8", name: "Claude Opus 4.8", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-5": { id: "claude-opus-5", name: "Claude Opus 5", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-5-5": { id: "claude-opus-5-5", name: "Claude Opus 5.5", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (latest)", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 2e5, maxTokens: 64e3, compat: { sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-4-6": { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-5": { id: "claude-sonnet-5", name: "Claude Sonnet 5", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-5-5": { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "openai-completions": { "chat:workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731": { id: "workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 0731", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 1048576, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true, requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" }, type: "chat" }, "chat:workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813": { id: "workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 1048576, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true, requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" }, type: "chat" }, "chat:workers-ai/@cf/deepseek-ai/deepseek-v4.1-flash-1017": { id: "workers-ai/@cf/deepseek-ai/deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash 1017", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.3, output: 1.2, cacheRead: 6e-3, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 1048576, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true, requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:workers-ai/@cf/google/gemma-4-26b-a4b-it": { id: "workers-ai/@cf/google/gemma-4-26b-a4b-it", name: "Gemma 4 26B A4B IT", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.3, cacheRead: 0.05, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 16384, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:workers-ai/@cf/ibm-granite/granite-4.0-h-micro": { id: "workers-ai/@cf/ibm-granite/granite-4.0-h-micro", name: "Granite 4.0 H Micro", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: false, input: ["text"], cost: { input: 0.017, output: 0.112, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131e3, maxTokens: 131e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, type: "chat" }, "chat:workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast": { id: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct fp8 Fast", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: false, input: ["text"], cost: { input: 0.293, output: 2.253, cacheRead: 0, cacheWrite: 0 }, contextWindow: 24e3, maxTokens: 24e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, type: "chat" }, "chat:workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct": { id: "workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B 16E Instruct", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: false, input: ["text", "image"], cost: { input: 0.27, output: 0.85, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131e3, maxTokens: 16384, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct": { id: "workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1 24B Instruct", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: false, input: ["text", "image"], cost: { input: 0.351, output: 0.555, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:workers-ai/@cf/moonshotai/kimi-k2.6": { id: "workers-ai/@cf/moonshotai/kimi-k2.6", name: "Kimi K2.6", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 256e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:workers-ai/@cf/moonshotai/kimi-k2.7-code": { id: "workers-ai/@cf/moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 262144, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:workers-ai/@cf/nvidia/nemotron-3-120b-a12b": { id: "workers-ai/@cf/nvidia/nemotron-3-120b-a12b", name: "Nemotron 3 Super 120B", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 256e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, type: "chat" }, "chat:workers-ai/@cf/openai/gpt-oss-120b": { id: "workers-ai/@cf/openai/gpt-oss-120b", name: "GPT OSS 120B", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.35, output: 0.75, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, type: "chat" }, "chat:workers-ai/@cf/openai/gpt-oss-20b": { id: "workers-ai/@cf/openai/gpt-oss-20b", name: "GPT OSS 20B", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.2, output: 0.3, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, type: "chat" }, "chat:workers-ai/@cf/qwen/qwen3-30b-a3b-fp8": { id: "workers-ai/@cf/qwen/qwen3-30b-a3b-fp8", name: "Qwen3 30B A3b fp8", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.0509, output: 0.335, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 32768, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, type: "chat" }, "chat:workers-ai/@cf/qwen/qwen3.8-27b": { id: "workers-ai/@cf/qwen/qwen3.8-27b", name: "Qwen3.8 27B", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.45, output: 3.2, cacheRead: 0.05, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 262144, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:workers-ai/@cf/zai-org/glm-4.7-flash": { id: "workers-ai/@cf/zai-org/glm-4.7-flash", name: "GLM-4.7-Flash", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.0605, output: 0.4, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, type: "chat" }, "chat:workers-ai/@cf/zai-org/glm-5.2": { id: "workers-ai/@cf/zai-org/glm-5.2", name: "Glm 5.2", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 256e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, type: "chat" }, "chat:workers-ai/@cf/zai-org/glm-5.3": { id: "workers-ai/@cf/zai-org/glm-5.3", name: "Glm 5.3", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 1048576, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, type: "chat" }, "chat:workers-ai/@cf/zai-org/glm-5.3-flash": { id: "workers-ai/@cf/zai-org/glm-5.3-flash", name: "Glm 5.3 Flash", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 1048576, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, sendSessionAffinityHeaders: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "openai-responses": { "chat:gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4.1-mini": { id: "gpt-4.1-mini", name: "GPT-4.1 mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4.1-nano": { id: "gpt-4.1-nano", name: "GPT-4.1 nano", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 32768, compat: { supportsStrictMode: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4o": { id: "gpt-4o", name: "GPT-4o", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 1.25, output: 5, cacheRead: 0.625, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4o-mini": { id: "gpt-4o-mini", name: "GPT-4o mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 0.075, output: 0.3, cacheRead: 0.0375, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5": { id: "gpt-5", name: "GPT-5", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 Mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.05, output: 0.4, cacheRead: 5e-3, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.1": { id: "gpt-5.1", name: "GPT-5.1", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-nano": { id: "gpt-5.4-nano", name: "GPT-5.4 nano", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-pro": { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 30, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.5-pro": { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tiers: [{ inputTokensAbove: 272e3, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [{ inputTokensAbove: 272e3, input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-astra": { id: "gpt-6-astra", name: "GPT-6 Astra", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, tiers: [{ inputTokensAbove: 272e3, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-luna": { id: "gpt-6-luna", name: "GPT-6 Luna", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, tiers: [{ inputTokensAbove: 272e3, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-sol": { id: "gpt-6-sol", name: "GPT-6 Sol", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6.1-sol": { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6.1-terra": { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25, tiers: [{ inputTokensAbove: 272e3, input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:o3": { id: "o3", name: "o3", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:o3-mini": { id: "o3-mini", name: "o3-mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text"], cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true }, type: "chat" }, "chat:o4-mini": { id: "o4-mini", name: "o4-mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } } };

// node_modules/@earendil-works/pi-ai/dist/model-catalog.js
function flattenModelCatalog(groups, type) {
  return Object.fromEntries(Object.values(groups).flatMap((models) => Object.values(models)).filter((model) => model.type === type).map((model) => [model.id, model]));
}
function flattenChatModelCatalog(_provider, groups) {
  return flattenModelCatalog(groups, "chat");
}
function flattenImageModelCatalog(_provider, groups) {
  return flattenModelCatalog(groups, "image");
}
function flattenClassifierModelCatalog(_provider, groups) {
  return flattenModelCatalog(groups, "classifier");
}

// node_modules/@earendil-works/pi-ai/dist/providers/cloudflare-ai-gateway.models.js
var CLOUDFLARE_AI_GATEWAY_MODELS = flattenChatModelCatalog("cloudflare-ai-gateway", cloudflare_ai_gateway_default);
var CLOUDFLARE_AI_GATEWAY_IMAGE_MODELS = flattenImageModelCatalog("cloudflare-ai-gateway", cloudflare_ai_gateway_default);
var CLOUDFLARE_AI_GATEWAY_CLASSIFIER_MODELS = flattenClassifierModelCatalog("cloudflare-ai-gateway", cloudflare_ai_gateway_default);

// node_modules/@earendil-works/pi-ai/dist/providers/data/github-copilot.json
var github_copilot_default = { "anthropic-messages": { "chat:claude-fable-5": { id: "claude-fable-5", name: "Claude Fable 5", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-fable-5.1": { id: "claude-fable-5.1", name: "Claude Fable 5.1", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-haiku-4.5": { id: "claude-haiku-4.5", name: "Claude Haiku 4.5 (latest)", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, contextWindow: 2e5, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsEagerToolInputStreaming: false }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-haiku-5.5": { id: "claude-haiku-5.5", name: "Claude Haiku 5.5", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, tiers: [{ inputTokensAbove: 1e5, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 }] }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-4.8": { id: "claude-opus-4.8", name: "Claude Opus 4.8", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-5": { id: "claude-opus-5", name: "Claude Opus 5", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-5.5": { id: "claude-opus-5.5", name: "Claude Opus 5.5", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-4.6": { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 1e6, maxTokens: 32e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { max: "max", minimal: "low" }, compat: { forceAdaptiveThinking: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-5": { id: "claude-sonnet-5", name: "Claude Sonnet 5", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-5.5": { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "openai-completions": { "chat:gemini-3.8-flash": { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStrictMode: true, supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gemini-4-argon": { id: "gemini-4-argon", name: "Gemini 4 Argon", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStrictMode: true, supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:kimi-k3": { id: "kimi-k3", name: "Kimi K3", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStrictMode: true, supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "openai-responses": { "chat:gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-nano": { id: "gpt-5.4-nano", name: "GPT-5.4 nano", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tiers: [{ inputTokensAbove: 2e5, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }] }, contextWindow: 105e4, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [{ inputTokensAbove: 272e3, input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10 }] }, contextWindow: 105e4, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-astra": { id: "gpt-6-astra", name: "GPT-6 Astra", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, tiers: [{ inputTokensAbove: 272e3, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }] }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-luna": { id: "gpt-6-luna", name: "GPT-6 Luna", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, tiers: [{ inputTokensAbove: 272e3, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 }] }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-sol": { id: "gpt-6-sol", name: "GPT-6 Sol", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6.1-sol": { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6.1-terra": { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25, tiers: [{ inputTokensAbove: 272e3, input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5 }] }, contextWindow: 105e4, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.5": { id: "grok-4.5", name: "Grok 4.5", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.6": { id: "grok-4.6", name: "Grok 4.6", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.7": { id: "grok-4.7", name: "Grok 4.7", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:mai-code-1.1-flash": { id: "mai-code-1.1-flash", name: "MAI-Code-1.1-Flash", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } } };

// node_modules/@earendil-works/pi-ai/dist/providers/github-copilot.models.js
var GITHUB_COPILOT_MODELS = flattenChatModelCatalog("github-copilot", github_copilot_default);
var GITHUB_COPILOT_IMAGE_MODELS = flattenImageModelCatalog("github-copilot", github_copilot_default);
var GITHUB_COPILOT_CLASSIFIER_MODELS = flattenClassifierModelCatalog("github-copilot", github_copilot_default);

// node_modules/@earendil-works/pi-ai/dist/providers/data/openai.json
var openai_default = { "openai-decisions": { "classifier:gpt-6-luna": { type: "classifier", id: "gpt-6-luna", name: "GPT-6 Luna", api: "openai-decisions", provider: "openai", baseUrl: "https://api.openai.com/v1", input: ["text", "image"], cost: { input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 0.2, output: 0, cacheRead: 0, cacheWrite: 0 }] }, contextWindow: 922e3 } }, "openai-responses": { "chat:chat-latest": { id: "chat-latest", name: "Chat Latest", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4": { id: "gpt-4", name: "GPT-4", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text"], cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 8192, compat: { supportsStrictMode: true }, type: "chat" }, "chat:gpt-4-turbo": { id: "gpt-4-turbo", name: "GPT-4 Turbo", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 4096, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4.1-mini": { id: "gpt-4.1-mini", name: "GPT-4.1 mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4.1-nano": { id: "gpt-4.1-nano", name: "GPT-4.1 nano", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4o": { id: "gpt-4o", name: "GPT-4o", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4o-2024-05-13": { id: "gpt-4o-2024-05-13", name: "GPT-4o (2024-05-13)", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 4096, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4o-2024-08-06": { id: "gpt-4o-2024-08-06", name: "GPT-4o (2024-08-06)", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4o-2024-11-20": { id: "gpt-4o-2024-11-20", name: "GPT-4o (2024-11-20)", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-4o-mini": { id: "gpt-4o-mini", name: "GPT-4o mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5": { id: "gpt-5", name: "GPT-5", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5-chat-latest": { id: "gpt-5-chat-latest", name: "GPT-5 Chat Latest", api: "openai-responses", baseUrl: "https://api.openai.com/v1", provider: "openai", reasoning: false, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, thinkingLevelMap: { off: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 Mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.05, output: 0.4, cacheRead: 5e-3, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5-pro": { id: "gpt-5-pro", name: "GPT-5 Pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 15, output: 120, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.1": { id: "gpt-5.1", name: "GPT-5.1", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.2-pro": { id: "gpt-5.2-pro", name: "GPT-5.2 Pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 21, output: 168, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.3-codex-spark": { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 32e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: 0 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsMidConvoSystemMessages: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsMidConvoSystemMessages: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-nano": { id: "gpt-5.4-nano", name: "GPT-5.4 nano", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-pro": { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 60, output: 270, cacheRead: 0, cacheWrite: 0 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsMidConvoSystemMessages: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 10, output: 45, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsMidConvoSystemMessages: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.5-pro": { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 60, output: 270, cacheRead: 0, cacheWrite: 0 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-cyber": { id: "gpt-5.6-cyber", name: "GPT-5.6 Cyber", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 12.5, output: 75, cacheRead: 1.25, cacheWrite: 15.625 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsExplicitPromptCacheMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tiers: [{ inputTokensAbove: 272e3, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsMidConvoSystemMessages: true, supportsExplicitPromptCacheMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [{ inputTokensAbove: 272e3, input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsMidConvoSystemMessages: true, supportsExplicitPromptCacheMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsMidConvoSystemMessages: true, supportsExplicitPromptCacheMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-astra": { id: "gpt-6-astra", name: "GPT-6 Astra", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, tiers: [{ inputTokensAbove: 272e3, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsMidConvoSystemMessages: true, supportsExplicitPromptCacheMode: true, supportsMidConvoEffort: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-luna": { id: "gpt-6-luna", name: "GPT-6 Luna", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, tiers: [{ inputTokensAbove: 272e3, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsMidConvoSystemMessages: true, supportsExplicitPromptCacheMode: true, supportsMidConvoEffort: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-sol": { id: "gpt-6-sol", name: "GPT-6 Sol", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsMidConvoSystemMessages: true, supportsExplicitPromptCacheMode: true, supportsMidConvoEffort: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6.1-sol": { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsMidConvoSystemMessages: true, supportsExplicitPromptCacheMode: true, supportsMidConvoEffort: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6.1-terra": { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25, tiers: [{ inputTokensAbove: 272e3, input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsMidConvoSystemMessages: true, supportsExplicitPromptCacheMode: true, supportsMidConvoEffort: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-daybreak-blue-latest": { id: "gpt-daybreak-blue-latest", name: "Daybreak Blue", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [{ inputTokensAbove: 272e3, input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsExplicitPromptCacheMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-daybreak-red-latest": { id: "gpt-daybreak-red-latest", name: "Daybreak Red", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 12.5, output: 75, cacheRead: 1.25, cacheWrite: 15.625 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsExplicitPromptCacheMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:o1": { id: "o1", name: "o1", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:o1-pro": { id: "o1-pro", name: "o1-pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 150, output: 600, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:o3": { id: "o3", name: "o3", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:o3-mini": { id: "o3-mini", name: "o3-mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text"], cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true }, type: "chat" }, "chat:o3-pro": { id: "o3-pro", name: "o3-pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 20, output: 80, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:o4-mini": { id: "o4-mini", name: "o4-mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true }, inputLimits: { maxRequestBytes: 536870912, images: { maxPerRequest: 1500, resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } } };

// node_modules/@earendil-works/pi-ai/dist/providers/openai.models.js
var OPENAI_MODELS = flattenChatModelCatalog("openai", openai_default);
var OPENAI_IMAGE_MODELS = flattenImageModelCatalog("openai", openai_default);
var OPENAI_CLASSIFIER_MODELS = flattenClassifierModelCatalog("openai", openai_default);

// node_modules/@earendil-works/pi-ai/dist/providers/data/opencode.json
var opencode_default = { "anthropic-messages": { "chat:claude-fable-5": { id: "claude-fable-5", name: "Claude Fable 5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-fable-5-1": { id: "claude-fable-5-1", name: "Claude Fable 5.1", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-haiku-4-5": { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, contextWindow: 2e5, maxTokens: 64e3, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-haiku-5-5": { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, tiers: [{ inputTokensAbove: 1e5, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 }] }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-4-5": { id: "claude-opus-4-5", name: "Claude Opus 4.5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 2e5, maxTokens: 64e3, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { max: "max" }, compat: { forceAdaptiveThinking: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-4-7": { id: "claude-opus-4-7", name: "Claude Opus 4.7", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-4-8": { id: "claude-opus-4-8", name: "Claude Opus 4.8", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-5": { id: "claude-opus-5", name: "Claude Opus 5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-opus-5-5": { id: "claude-opus-5-5", name: "Claude Opus 5.5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, tiers: [{ inputTokensAbove: 2e5, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 }] }, contextWindow: 2e5, maxTokens: 64e3, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-4-6": { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 1e6, maxTokens: 64e3, thinkingLevelMap: { max: "max" }, compat: { forceAdaptiveThinking: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-5": { id: "claude-sonnet-5", name: "Claude Sonnet 5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:claude-sonnet-5-5": { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsMidConvoSystemMessages: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:qwen3.5-plus": { id: "qwen3.5-plus", name: "Qwen3.5 Plus", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 }, contextWindow: 262144, maxTokens: 65536, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:qwen3.6-plus": { id: "qwen3.6-plus", name: "Qwen3.6 Plus", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.625 }, contextWindow: 262144, maxTokens: 65536, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:qwen3.8-flash": { id: "qwen3.8-flash", name: "Qwen3.8 Flash", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/inference/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 }, contextWindow: 1e6, maxTokens: 131072, compat: { allowEmptySignature: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "google-generative-ai": { "chat:gemini-3-flash": { id: "gemini-3-flash", name: "Gemini 3 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/inference/google/v1beta", reasoning: true, input: ["text", "image"], cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gemini-3.1-pro": { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro Preview", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/inference/google/v1beta", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 0 }] }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gemini-3.5-flash": { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/inference/google/v1beta", reasoning: true, input: ["text", "image"], cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gemini-3.5-flash-lite": { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/inference/google/v1beta", reasoning: true, input: ["text", "image"], cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gemini-3.6-flash": { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/inference/google/v1beta", reasoning: true, input: ["text", "image"], cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gemini-3.7-flash": { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/inference/google/v1beta", reasoning: true, input: ["text", "image"], cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gemini-3.8-flash": { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/inference/google/v1beta", reasoning: true, input: ["text", "image"], cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gemini-4-argon": { id: "gemini-4-argon", name: "Gemini 4 Argon", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/inference/google/v1beta", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "openai-completions": { "chat:beam-free": { id: "beam-free", name: "Beam Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, type: "chat" }, "chat:big-pickle": { id: "big-pickle", name: "Big Pickle", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 32e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, type: "chat" }, "chat:deepseek-v4-pro": { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 1.74, output: 3.48, cacheRead: 0.145, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 384e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", supportsLongCacheRetention: false, requiresReasoningContentOnAssistantMessages: true }, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" }, type: "chat" }, "chat:deepseek-v4.1-flash": { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.3, output: 1.2, cacheRead: 6e-3, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 384e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", supportsLongCacheRetention: false, requiresReasoningContentOnAssistantMessages: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:deepseek-v4.1-flash-free": { id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 32e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", requiresReasoningContentOnAssistantMessages: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:flint-40b-free": { id: "flint-40b-free", name: "Flint 40B Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 65536, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, type: "chat" }, "chat:glm-5": { id: "glm-5", name: "GLM-5", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 }, contextWindow: 204800, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, type: "chat" }, "chat:glm-5.1": { id: "glm-5.1", name: "GLM-5.1", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, contextWindow: 204800, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, type: "chat" }, "chat:glm-5.2": { id: "glm-5.2", name: "GLM-5.2", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" }, type: "chat" }, "chat:glm-5.3": { id: "glm-5.3", name: "GLM-5.3", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, type: "chat" }, "chat:glm-5.3-flash": { id: "glm-5.3-flash", name: "GLM-5.3-Flash", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:glm-5.3-flash-free": { id: "glm-5.3-flash-free", name: "GLM-5.3-Flash Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 32e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:kimi-k2.5": { id: "kimi-k2.5", name: "Kimi K2.5", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.6, output: 3, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 65536, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", supportsLongCacheRetention: false }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:kimi-k2.6": { id: "kimi-k2.6", name: "Kimi K2.6", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 65536, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, thinkingFormat: "deepseek", supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:kimi-k2.7-code": { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 262144, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:kimi-k3": { id: "kimi-k3", name: "Kimi K3", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 }, contextWindow: 1048576, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:mimo-v2.6-flash-free": { id: "mimo-v2.6-flash-free", name: "MiMo-V2.6-Flash Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 32e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:minimax-m2.5": { id: "minimax-m2.5", name: "MiniMax-M2.5", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, contextWindow: 204800, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, type: "chat" }, "chat:minimax-m2.7": { id: "minimax-m2.7", name: "MiniMax-M2.7", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, contextWindow: 204800, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", supportsLongCacheRetention: false }, type: "chat" }, "chat:minimax-m3": { id: "minimax-m3", name: "MiniMax-M3", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, contextWindow: 512e3, maxTokens: 128e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:mistral-large-4": { id: "mistral-large-4", name: "Mistral Large 4", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.68, output: 2.09, cacheRead: 0.07, cacheWrite: 0 }, contextWindow: 524288, maxTokens: 262144, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:nemotron-3.5-lightning-free": { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 262144, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, type: "chat" }, "chat:nemotron-3.5-super-vl-free": { id: "nemotron-3.5-super-vl-free", name: "Nemotron 3.5 Super VL Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:qwen3.8-max": { id: "qwen3.8-max", name: "Qwen3.8 Max", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 }, contextWindow: 262144, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "openai-responses": { "chat:gpt-5": { id: "gpt-5", name: "GPT-5", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5-codex": { id: "gpt-5-codex", name: "GPT-5 Codex", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.05, output: 0.4, cacheRead: 5e-3, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.1": { id: "gpt-5.1", name: "GPT-5.1", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.1-codex": { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.1-codex-max": { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.1-codex-mini": { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.2-codex": { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: 0 }] }, contextWindow: 272e3, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-nano": { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.4-pro": { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 30, cacheWrite: 0 }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 10, output: 45, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.5-pro": { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 30, cacheWrite: 0 }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tiers: [{ inputTokensAbove: 272e3, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [{ inputTokensAbove: 272e3, input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-astra": { id: "gpt-6-astra", name: "GPT-6 Astra", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, tiers: [{ inputTokensAbove: 272e3, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-luna": { id: "gpt-6-luna", name: "GPT-6 Luna", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, tiers: [{ inputTokensAbove: 272e3, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-sol": { id: "gpt-6-sol", name: "GPT-6 Sol", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6.1-sol": { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsOpenAIGrammarTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.5": { id: "grok-4.5", name: "Grok 4.5", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 0.6, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 5e5, compat: { sessionAffinityFormat: "openai-nosession" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.6": { id: "grok-4.6", name: "Grok 4.6", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 5e5, compat: { sessionAffinityFormat: "openai-nosession" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.7": { id: "grok-4.7", name: "Grok 4.7", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 5e5, compat: { sessionAffinityFormat: "openai-nosession" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-build-0.1": { id: "grok-build-0.1", name: "Grok Build 0.1", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 256e3, compat: { sessionAffinityFormat: "openai-nosession", supportsReasoningEffort: false }, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:muse-spark-1.2": { id: "muse-spark-1.2", name: "Muse Spark 1.2", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { sessionAffinityFormat: "openai-nosession" }, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:muse-spark-1.3": { id: "muse-spark-1.3", name: "Muse Spark 1.3", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { sessionAffinityFormat: "openai-nosession" }, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:muse-wonder-1.0": { id: "muse-wonder-1.0", name: "Muse Wonder", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/inference/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { sessionAffinityFormat: "openai-nosession" }, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "typesafe-system-one": { "classifier:jev-1.13": { type: "classifier", id: "jev-1.13", name: "Jev 1.13", api: "typesafe-system-one", provider: "opencode", baseUrl: "https://opencode.ai/inference/systemone/v1", input: ["text"], cost: { input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32e3 }, "classifier:jev-1.13-free": { type: "classifier", id: "jev-1.13-free", name: "Jev 1.13 Free", api: "typesafe-system-one", provider: "opencode", baseUrl: "https://opencode.ai/inference/systemone/v1", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32e3 } } };

// node_modules/@earendil-works/pi-ai/dist/providers/opencode.models.js
var OPENCODE_MODELS = flattenChatModelCatalog("opencode", opencode_default);
var OPENCODE_IMAGE_MODELS = flattenImageModelCatalog("opencode", opencode_default);
var OPENCODE_CLASSIFIER_MODELS = flattenClassifierModelCatalog("opencode", opencode_default);

// node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json
var opencode_go_default = { "anthropic-messages": { "chat:claude-haiku-5-5": { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", api: "anthropic-messages", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, tiers: [{ inputTokensAbove: 1e5, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 }] }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:minimax-m3": { id: "minimax-m3", name: "MiniMax-M3", api: "anthropic-messages", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0, tiers: [{ inputTokensAbove: 512e3, input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 }] }, contextWindow: 1e6, maxTokens: 131072, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:qwen3.7-plus": { id: "qwen3.7-plus", name: "Qwen3.7 Plus", api: "anthropic-messages", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5, tiers: [{ inputTokensAbove: 256e3, input: 1.2, output: 4.8, cacheRead: 0.12, cacheWrite: 1.5 }] }, contextWindow: 1e6, maxTokens: 65536, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:qwen3.8-flash": { id: "qwen3.8-flash", name: "Qwen3.8 Flash", api: "anthropic-messages", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 }, contextWindow: 1e6, maxTokens: 131072, compat: { allowEmptySignature: true }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:qwen3.8-max": { id: "qwen3.8-max", name: "Qwen3.8 Max", api: "anthropic-messages", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 131072, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "google-generative-ai": { "chat:gemini-4-argon": { id: "gemini-4-argon", name: "Gemini 4 Argon", api: "google-generative-ai", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/google/v1beta", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "openai-completions": { "chat:beam-free": { id: "beam-free", name: "Beam Free", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, type: "chat" }, "chat:deepseek-v4-pro": { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (New)", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text"], cost: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 384e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" }, type: "chat" }, "chat:deepseek-v4.1-flash": { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.6, cacheRead: 3e-3, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 384e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:glm-5.2": { id: "glm-5.2", name: "GLM-5.2", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" }, type: "chat" }, "chat:glm-5.3": { id: "glm-5.3", name: "GLM-5.3", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, type: "chat" }, "chat:glm-5.3-flash": { id: "glm-5.3-flash", name: "GLM-5.3-Flash", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:hy3": { id: "hy3", name: "Hy3", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text"], cost: { input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 128e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: null }, type: "chat" }, "chat:hy4-preview": { id: "hy4-preview", name: "Hy4 preview", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text"], cost: { input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: 0 }, contextWindow: 1024e3, maxTokens: 64e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null }, type: "chat" }, "chat:iceman-contributor-free": { id: "iceman-contributor-free", name: "Iceman Contributor Free", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, type: "chat" }, "chat:kimi-k2.7-code": { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 262144, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:kimi-k3": { id: "kimi-k3", name: "Kimi K3", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 }, contextWindow: 1048576, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true }, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:kimi-k3.1-pro": { id: "kimi-k3.1-pro", name: "Kimi K3.1 Pro", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2 }, contextWindow: 1048576, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens", supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:longcat-2.0": { id: "longcat-2.0", name: "LongCat-2.0", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text"], cost: { input: 0.3, output: 1.2, cacheRead: 6e-3, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, type: "chat" }, "chat:mimo-v2.5": { id: "mimo-v2.5", name: "MiMo V2.5", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.14, output: 0.28, cacheRead: 28e-4, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:mimo-v2.5-pro": { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text"], cost: { input: 0.435, output: 0.87, cacheRead: 3625e-6, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 128e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, type: "chat" }, "chat:mimo-v2.6-flash": { id: "mimo-v2.6-flash", name: "MiMo-V2.6-Flash", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.14, output: 0.28, cacheRead: 28e-4, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:mimo-v2.6-pro": { id: "mimo-v2.6-pro", name: "MiMo-V2.6-Pro", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.435, output: 0.87, cacheRead: 3625e-6, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:minimax-m3.1-flash": { id: "minimax-m3.1-flash", name: "MiniMax M3.1 Flash", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 512e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:step-5-preview": { id: "step-5-preview", name: "Step 5 Preview", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 2.7, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 65536, compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: true, maxTokensField: "max_tokens" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } }, "openai-responses": { "chat:gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tiers: [{ inputTokensAbove: 272e3, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsAdditionalTools: true }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:gpt-6-luna": { id: "gpt-6-luna", name: "GPT-6 Luna", api: "openai-responses", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, tiers: [{ inputTokensAbove: 272e3, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 }] }, contextWindow: 105e4, maxTokens: 128e3, compat: { sessionAffinityFormat: "openai-nosession", supportsMidConvoSystemMessages: true, supportsAdditionalTools: true }, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.7": { id: "grok-4.7", name: "Grok 4.7", api: "openai-responses", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 5e5, compat: { sessionAffinityFormat: "openai-nosession" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:muse-spark-1.2-contributor": { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", api: "openai-responses", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.2, cacheRead: 2e-3, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { sessionAffinityFormat: "openai-nosession" }, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:muse-spark-1.3-contributor": { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", api: "openai-responses", provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.2, cacheRead: 2e-3, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, compat: { sessionAffinityFormat: "openai-nosession" }, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } } };

// node_modules/@earendil-works/pi-ai/dist/providers/opencode-go.models.js
var OPENCODE_GO_MODELS = flattenChatModelCatalog("opencode-go", opencode_go_default);
var OPENCODE_GO_IMAGE_MODELS = flattenImageModelCatalog("opencode-go", opencode_go_default);
var OPENCODE_GO_CLASSIFIER_MODELS = flattenClassifierModelCatalog("opencode-go", opencode_go_default);

// node_modules/@earendil-works/pi-ai/dist/providers/data/xai.json
var xai_default = { "openai-responses": { "chat:grok-4.3": { id: "grok-4.3", name: "Grok 4.3", api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 2.5, output: 5, cacheRead: 0.4, cacheWrite: 0 }] }, contextWindow: 1e6, maxTokens: 3e4, compat: { supportsLongCacheRetention: false }, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.5": { id: "grok-4.5", name: "Grok 4.5", api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 0.6, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 5e5, compat: { supportsLongCacheRetention: false }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.6": { id: "grok-4.6", name: "Grok 4.6", api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 5e5, compat: { supportsLongCacheRetention: false }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" }, "chat:grok-4.7": { id: "grok-4.7", name: "Grok 4.7", api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 5e5, compat: { supportsLongCacheRetention: false }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, inputLimits: { images: { resize: { maxWidth: 2e3, maxHeight: 2e3, maxBytes: 4718592, jpegQuality: 80 } } }, type: "chat" } } };

// node_modules/@earendil-works/pi-ai/dist/providers/xai.models.js
var XAI_MODELS = flattenChatModelCatalog("xai", xai_default);
var XAI_IMAGE_MODELS = flattenImageModelCatalog("xai", xai_default);
var XAI_CLASSIFIER_MODELS = flattenClassifierModelCatalog("xai", xai_default);

// node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js
var FifoQueue = class {
  incoming = [];
  outgoing = [];
  get length() {
    return this.incoming.length + this.outgoing.length;
  }
  enqueue(value) {
    this.incoming.push(value);
  }
  dequeue() {
    if (this.outgoing.length === 0) {
      while (this.incoming.length > 0) {
        this.outgoing.push(this.incoming.pop());
      }
    }
    return this.outgoing.pop();
  }
};
var EventStream = class {
  queue = new FifoQueue();
  waiting = new FifoQueue();
  done = false;
  finalResultPromise;
  resolveFinalResult;
  isComplete;
  extractResult;
  constructor(isComplete, extractResult) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }
  push(event) {
    if (this.done)
      return;
    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }
    const waiter = this.waiting.dequeue();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.enqueue(event);
    }
  }
  end(result) {
    this.done = true;
    if (result !== void 0) {
      this.resolveFinalResult(result);
    }
    while (this.waiting.length > 0) {
      const waiter = this.waiting.dequeue();
      waiter({ value: void 0, done: true });
    }
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.dequeue();
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise((resolve) => this.waiting.enqueue(resolve));
        if (result.done)
          return;
        yield result.value;
      }
    }
  }
  result() {
    return this.finalResultPromise;
  }
};
var AssistantMessageEventStream = class extends EventStream {
  #startedAt = Date.now();
  #startedAtMonotonic = performance.now();
  constructor() {
    super((event) => event.type === "done" || event.type === "error", (event) => {
      if (event.type === "done") {
        return event.message;
      } else if (event.type === "error") {
        return event.error;
      }
      throw new Error("Unexpected event type for final result");
    });
  }
  push(event) {
    if (event.type === "done")
      this.#time(event.message);
    else if (event.type === "error")
      this.#time(event.error);
    super.push(event);
  }
  end(result) {
    if (result !== void 0)
      this.#time(result);
    super.end(result);
  }
  #time(message) {
    if (this.done || message.durationMs !== void 0 || message.timestamp < this.#startedAt)
      return;
    message.durationMs = Math.max(0, Math.round(performance.now() - this.#startedAtMonotonic));
  }
};
function createAssistantMessageEventStream() {
  return new AssistantMessageEventStream();
}

// node_modules/@earendil-works/pi-ai/dist/utils/text.js
function contentText(content, separator = "\n") {
  if (typeof content === "string")
    return content;
  return content.filter((block) => block.type === "text").map((block) => block.text).join(separator);
}
function getSystemMessageText(message) {
  const parts = [contentText(message.content)];
  for (const text of Object.values(message.sections ?? {})) {
    if (text !== null)
      parts.push(text);
  }
  return parts.filter((part) => part.length > 0).join("\n\n");
}
function renderSystemMessageUpdate(message) {
  const parts = [];
  const text = contentText(message.content);
  if (text.length > 0)
    parts.push(text);
  for (const [name, value] of Object.entries(message.sections ?? {})) {
    parts.push(value === null ? `Removed system prompt section "${name}".` : `Updated system prompt section "${name}":

${value}`);
  }
  return parts.join("\n\n");
}

// node_modules/@earendil-works/pi-ai/dist/utils/transcript.js
function createInitialSystemMessage(systemPrompt, tools) {
  const hasSystemPrompt = systemPrompt !== void 0 && systemPrompt.length > 0;
  const hasTools = tools !== void 0 && tools.length > 0;
  if (!hasSystemPrompt && !hasTools)
    return void 0;
  return {
    role: "system",
    content: systemPrompt ?? "",
    ...hasTools ? { toolsAdded: tools } : {},
    timestamp: 0
  };
}
function normalizeContext(context) {
  const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
  const messages = initialMessage ? [initialMessage, ...context.messages] : context.messages;
  return { messages };
}
function isSystemMessage(message) {
  return message.role === "system";
}
function getInitialSystemMessage(messages) {
  const first = messages[0];
  return first && isSystemMessage(first) ? first : void 0;
}
function getCurrentTools(messages) {
  const tools = /* @__PURE__ */ new Map();
  for (const message of messages) {
    if (!isSystemMessage(message))
      continue;
    for (const tool of message.toolsRemoved ?? [])
      tools.delete(tool.name);
    for (const tool of message.toolsAdded ?? [])
      tools.set(tool.name, tool);
  }
  return [...tools.values()];
}
function getCurrentSystemMessage(messages) {
  const content = [];
  const sections = /* @__PURE__ */ new Map();
  let timestamp;
  for (const message of messages) {
    if (!isSystemMessage(message))
      continue;
    timestamp ??= message.timestamp;
    const text = contentText(message.content);
    if (text.length > 0)
      content.push(text);
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null)
        sections.delete(name);
      else
        sections.set(name, value);
    }
  }
  const tools = getCurrentTools(messages);
  if (timestamp === void 0 && tools.length === 0)
    return void 0;
  return {
    role: "system",
    content: content.join("\n\n"),
    ...sections.size > 0 ? { sections: Object.fromEntries(sections) } : {},
    ...tools.length > 0 ? { toolsAdded: tools } : {},
    timestamp: timestamp ?? 0
  };
}
function collapseSystemMessages(context) {
  const head = getCurrentSystemMessage(context.messages);
  const messages = context.messages.filter((message) => message.role !== "system");
  return { messages: head ? [head, ...messages] : messages };
}
function resolveTranscript(context, supportsMidConvoSystemMessages) {
  return supportsMidConvoSystemMessages ? context : collapseSystemMessages(context);
}
function findLastNonAdditiveToolChange(systemMessages) {
  const declared = /* @__PURE__ */ new Set();
  let last = -1;
  for (let index = 0; index < systemMessages.length; index++) {
    const message = systemMessages[index];
    if ((message.toolsRemoved?.length ?? 0) > 0)
      last = index;
    for (const tool of message.toolsAdded ?? []) {
      if (declared.has(tool.name))
        last = index;
      declared.add(tool.name);
    }
  }
  return last;
}
function resolveTranscriptTools(messages, support) {
  const systemMessages = messages.filter(isSystemMessage);
  if (support === "none") {
    return { requestTools: getCurrentTools(systemMessages), foldedSystemMessages: systemMessages.length };
  }
  if (support === "changes")
    return { requestTools: [], foldedSystemMessages: 0 };
  const folded = Math.max(getInitialSystemMessage(messages) ? 1 : 0, findLastNonAdditiveToolChange(systemMessages) + 1);
  return { requestTools: getCurrentTools(systemMessages.slice(0, folded)), foldedSystemMessages: folded };
}

// node_modules/@earendil-works/pi-ai/dist/models.js
function calculateCost(model, usage) {
  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  let rates = model.cost;
  let matchedThreshold = -1;
  for (const tier of model.cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }
  const longWrite = usage.cacheWrite1h ?? 0;
  const shortWrite = usage.cacheWrite - longWrite;
  usage.cost.input = rates.input / 1e6 * usage.input;
  usage.cost.output = rates.output / 1e6 * usage.output;
  usage.cost.cacheRead = rates.cacheRead / 1e6 * usage.cacheRead;
  usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1e6;
  usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  usage.cost.totalFromProvider = false;
  return usage.cost;
}
var EXTENDED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function getSupportedThinkingLevels(model) {
  if (!model.reasoning)
    return ["off"];
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null)
      return false;
    if (level === "xhigh" || level === "max")
      return mapped !== void 0;
    return true;
  });
}

// node_modules/@earendil-works/pi-ai/dist/utils/hash.js
function shortHash(str) {
  let h1 = 3735928559;
  let h2 = 1103547991;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

// node_modules/@earendil-works/pi-ai/dist/utils/sanitize-unicode.js
function sanitizeSurrogates(text) {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

// node_modules/@earendil-works/pi-ai/dist/utils/json-parse.js
var import_partial_json = __toESM(require_dist(), 1);
var VALID_JSON_ESCAPES = /* @__PURE__ */ new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);
function isControlCharacter(char) {
  const codePoint = char.codePointAt(0);
  return codePoint !== void 0 && codePoint >= 0 && codePoint <= 31;
}
function escapeControlCharacter(char) {
  switch (char) {
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "	":
      return "\\t";
    default:
      return `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
  }
}
function repairJson(json) {
  let repaired = "";
  let inString = false;
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (!inString) {
      repaired += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }
    if (char === '"') {
      repaired += char;
      inString = false;
      continue;
    }
    if (char === "\\") {
      const nextChar = json[index + 1];
      if (nextChar === void 0) {
        repaired += "\\\\";
        continue;
      }
      if (nextChar === "u") {
        const unicodeDigits = json.slice(index + 2, index + 6);
        if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
          repaired += `\\u${unicodeDigits}`;
          index += 5;
          continue;
        }
      }
      if (VALID_JSON_ESCAPES.has(nextChar)) {
        repaired += `\\${nextChar}`;
        index += 1;
        continue;
      }
      repaired += "\\\\";
      continue;
    }
    repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
  }
  return repaired;
}
function parseJsonWithRepair(json) {
  try {
    return JSON.parse(json);
  } catch (error) {
    const repairedJson = repairJson(json);
    if (repairedJson !== json) {
      return JSON.parse(repairedJson);
    }
    throw error;
  }
}
function parseToolCallArguments(json) {
  if (!json?.trim())
    return { arguments: {} };
  try {
    const parsed = parseJsonWithRepair(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be a JSON object");
    }
    return { arguments: parsed };
  } catch (error) {
    return {
      arguments: {},
      argumentsError: `${error instanceof Error ? error.message : String(error)}

Received arguments:
${json}`
    };
  }
}

// node_modules/@earendil-works/pi-ai/dist/utils/streaming-json.js
var MAX_REPORTED_DEPTH = 32;
var ROOT_SLOT = { kind: "root" };
var CREDIT_PER_APPEND = 256;
var CREDIT_PER_CHARACTER = 8;
var MAX_PENDING_SCALAR_LENGTH = 64;
var NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
var NUMBER_WITHOUT_EXPONENT_DIGITS = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?)[eE][+-]?$/;
var LITERALS = [
  ["true", true],
  ["false", false],
  ["null", null]
];
var QUOTE = 34;
var BACKSLASH = 92;
var StreamingJsonParser = class {
  #root = void 0;
  #done = false;
  #stack = [];
  #string = void 0;
  #scalar = "";
  #scalarSlot = void 0;
  /** Sum of `size + 1` over the open path: what a fresh snapshot copies. */
  #pathCost = 0;
  #credit = 0;
  #dirty = false;
  #snapshot = void 0;
  /** Changes of the piece being read. */
  #changes = [];
  /**
   * Read the next piece of text; returns the changes it made, in order. Costs time linear in `text.length`.
   */
  append(text) {
    this.#credit += CREDIT_PER_APPEND + CREDIT_PER_CHARACTER * text.length;
    this.#changes = [];
    if (this.#string !== void 0)
      this.#string.change = void 0;
    let index = 0;
    while (index < text.length && !this.#done) {
      const open = this.#string;
      if (open !== void 0)
        index = this.#readString(open, text, index);
      else if (this.#scalar !== "")
        index = this.#readScalar(text, index);
      else
        this.#structural(text[index++]);
    }
    return this.#changes;
  }
  /**
   * The value of the text read so far: `undefined` before a value starts, otherwise a plain JSON value that never
   * changes afterwards. Returns the previous snapshot while the text read since did not change the value, or while a
   * fresh copy of the open path is not yet paid for (see the module comment).
   */
  snapshot() {
    if (!this.#dirty)
      return this.#snapshot;
    const pending = this.#pendingScalar();
    const cost = this.#pathCost + (pending === void 0 ? 0 : 1);
    if (cost > this.#credit)
      return this.#snapshot;
    this.#credit -= cost;
    this.#dirty = false;
    this.#snapshot = this.#copyOpenPath(pending);
    return this.#snapshot;
  }
  /** Read string characters from `start` until the string ends or the text does; returns the next index. */
  #readString(open, text, start) {
    let runStart = start;
    for (let index = start; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (open.escape !== "") {
        if (this.#continueEscape(open, text[index])) {
          runStart = index + 1;
          continue;
        }
        runStart = index;
      }
      if (code === QUOTE) {
        if (index > runStart)
          this.#appendString(open, text.slice(runStart, index));
        this.#endString(open);
        return index + 1;
      }
      if (code === BACKSLASH) {
        if (index > runStart)
          this.#appendString(open, text.slice(runStart, index));
        open.escape = "\\";
        runStart = index + 1;
      }
    }
    if (text.length > runStart)
      this.#appendString(open, text.slice(runStart));
    return text.length;
  }
  /** Read number or literal characters from `start` up to the next delimiter; returns the delimiter's index. */
  #readScalar(text, start) {
    let end = start;
    while (end < text.length && !isDelimiter(text[end]))
      end++;
    if (end > start) {
      this.#scalar += text.slice(start, end);
      if (this.#scalarSlot !== void 0)
        this.#dirty = true;
    }
    if (end < text.length)
      this.#endScalar();
    return end;
  }
  /** Handle one character outside strings. */
  #structural(char) {
    switch (char) {
      case " ":
      case "	":
      case "\n":
      case "\r":
        return;
      case '"':
        this.#startString();
        return;
      case "{":
      case "[":
        this.#openContainer(char === "{" ? {} : []);
        return;
      case "}":
      case "]":
        this.#closeContainer();
        return;
      case ":": {
        const frame = this.#stack.at(-1);
        if (frame !== void 0 && !Array.isArray(frame.container) && frame.phase === "colon")
          frame.phase = "value";
        return;
      }
      case ",": {
        const frame = this.#stack.at(-1);
        if (frame !== void 0)
          frame.phase = Array.isArray(frame.container) ? "value" : "key";
        return;
      }
      default:
        this.#scalar = char;
        this.#scalarSlot = this.#valueSlot();
        if (this.#scalarSlot !== void 0)
          this.#dirty = true;
    }
  }
  /** Where a value starting now goes, or `undefined` when this position takes no value. */
  #valueSlot() {
    const frame = this.#stack.at(-1);
    if (frame === void 0)
      return this.#root === void 0 ? ROOT_SLOT : void 0;
    if (Array.isArray(frame.container))
      return { kind: "element", index: frame.container.length };
    if ((frame.phase === "value" || frame.phase === "colon") && frame.key !== void 0) {
      return { kind: "member", key: frame.key };
    }
    return void 0;
  }
  #startString() {
    const frame = this.#stack.at(-1);
    if (frame !== void 0 && !Array.isArray(frame.container) && (frame.phase === "key" || frame.phase === "comma")) {
      this.#string = { target: "key", slot: void 0, text: "", escape: "", path: void 0, change: void 0 };
      return;
    }
    const slot = this.#valueSlot();
    const path = this.#reportedPath(slot);
    this.#string = { target: "value", slot, text: "", escape: "", path, change: void 0 };
    this.#place(slot, "");
    if (path !== void 0)
      this.#string.change = this.#report({ kind: "set", path, value: "" });
  }
  /** The path of a value at `slot` in the innermost open container, when its changes are reported. */
  #reportedPath(slot) {
    if (slot === void 0)
      return void 0;
    if (slot.kind === "root")
      return [];
    const frame = this.#stack.at(-1);
    if (!frame.reportsInside)
      return void 0;
    return [...frame.path, slot.kind === "member" ? slot.key : slot.index];
  }
  #report(change) {
    this.#changes.push(change);
    return change;
  }
  /** Continue an escape with `char`; returns false when `char` is not part of it and must be read normally. */
  #continueEscape(open, char) {
    if (open.escape === "\\") {
      const decoded = SIMPLE_ESCAPES[char];
      if (decoded !== void 0) {
        open.escape = "";
        this.#appendString(open, decoded);
        return true;
      }
      if (char === "u") {
        open.escape = "\\u";
        return true;
      }
      open.escape = "";
      this.#appendString(open, "\\");
      return false;
    }
    if (isHexDigit(char)) {
      open.escape += char;
      if (open.escape.length < 6)
        return true;
      const decoded = String.fromCharCode(Number.parseInt(open.escape.slice(2), 16));
      open.escape = "";
      this.#appendString(open, decoded);
      return true;
    }
    const literal = open.escape;
    open.escape = "";
    this.#appendString(open, literal);
    return false;
  }
  #appendString(open, text) {
    open.text += text;
    if (open.target !== "value")
      return;
    this.#place(open.slot, open.text);
    if (open.path === void 0)
      return;
    const change = open.change;
    if (change !== void 0 && this.#changes.at(-1) === change) {
      if (change.kind === "set")
        change.value = change.value + text;
      else
        change.text += text;
      return;
    }
    open.change = this.#report({ kind: "append", path: open.path, text });
  }
  #endString(open) {
    this.#string = void 0;
    const frame = this.#stack.at(-1);
    if (open.target === "key") {
      if (frame === void 0)
        return;
      frame.key = open.text;
      frame.phase = "colon";
      return;
    }
    this.#valueEnded(frame);
  }
  #endScalar() {
    const token = this.#scalar;
    const slot = this.#scalarSlot;
    this.#scalar = "";
    this.#scalarSlot = void 0;
    const value = scalarValue(token);
    if (value !== void 0) {
      this.#place(slot, value);
      const path = this.#reportedPath(slot);
      if (path !== void 0)
        this.#report({ kind: "set", path, value });
    }
    this.#valueEnded(this.#stack.at(-1));
  }
  /** The value of the unterminated scalar at the end of the text, if it shows. */
  #pendingScalar() {
    const slot = this.#scalarSlot;
    const token = this.#scalar;
    if (slot === void 0 || token === "" || token.length > MAX_PENDING_SCALAR_LENGTH)
      return void 0;
    const value = pendingScalarValue(token);
    return value === void 0 ? void 0 : { slot, value };
  }
  #openContainer(container) {
    const slot = this.#valueSlot();
    const path = this.#reportedPath(slot);
    this.#place(slot, container);
    this.#stack.push({
      container,
      slot,
      path,
      reportsInside: path !== void 0 && path.length < MAX_REPORTED_DEPTH,
      size: 0,
      key: void 0,
      phase: Array.isArray(container) ? "value" : "key"
    });
    this.#pathCost += 1;
    this.#dirty = true;
    if (path !== void 0)
      this.#report({ kind: "set", path, value: Array.isArray(container) ? [] : {} });
  }
  #closeContainer() {
    const frame = this.#stack.pop();
    if (frame === void 0)
      return;
    this.#pathCost -= frame.size + 1;
    this.#dirty = true;
    if (frame.path !== void 0 && !frame.reportsInside) {
      this.#report({ kind: "set", path: frame.path, value: frame.container });
    }
    this.#valueEnded(this.#stack.at(-1));
  }
  /** A value in `frame`, or the root value when there is no frame, has ended. */
  #valueEnded(frame) {
    if (frame === void 0) {
      if (this.#root !== void 0)
        this.#done = true;
      return;
    }
    frame.phase = "comma";
  }
  /** Set the value at `slot` in the open path; nothing for a value in an invalid position. */
  #place(slot, value) {
    if (slot === void 0)
      return;
    this.#dirty = true;
    if (slot.kind === "root") {
      this.#root = value;
      return;
    }
    const frame = this.#stack.at(-1);
    if (slot.kind === "element") {
      const elements = frame.container;
      if (slot.index === elements.length) {
        frame.size++;
        this.#pathCost++;
      }
      elements[slot.index] = value;
      return;
    }
    const members = frame.container;
    if (!Object.hasOwn(members, slot.key)) {
      frame.size++;
      this.#pathCost++;
    }
    setMember(members, slot.key, value);
  }
  /** A fresh snapshot: copies of the open containers, innermost first, each holding the copy of its open child. */
  #copyOpenPath(pending) {
    if (this.#stack.length === 0)
      return pending?.slot.kind === "root" ? pending.value : this.#root;
    let child;
    let childSlot;
    for (let depth = this.#stack.length - 1; depth >= 0; depth--) {
      const frame = this.#stack[depth];
      const copy = Array.isArray(frame.container) ? frame.container.slice() : { ...frame.container };
      if (depth === this.#stack.length - 1 && pending !== void 0)
        setSlot(copy, pending.slot, pending.value);
      if (child !== void 0 && childSlot !== void 0)
        setSlot(copy, childSlot, child);
      child = copy;
      childSlot = frame.slot;
    }
    return childSlot?.kind === "root" ? child : this.#root;
  }
};
var ToolCallArgumentsStream = class {
  #text = "";
  #parser = new StreamingJsonParser();
  #snapshot = void 0;
  #arguments = {};
  /** The raw argument text received so far. */
  get text() {
    return this.#text;
  }
  /** Append a piece of argument text; returns the partial arguments, a new object whenever they changed. */
  append(delta) {
    this.#text += delta;
    this.#parser.append(delta);
    return this.#partial();
  }
  /**
   * Take the provider's complete argument text. When it continues the text so far, returns the missing piece as
   * `delta`; otherwise starts over with `text`. Either way returns the partial arguments of `text`.
   */
  replace(text) {
    if (text.startsWith(this.#text)) {
      const delta = text.slice(this.#text.length);
      return { delta, arguments: delta === "" ? this.#partial() : this.append(delta) };
    }
    this.#text = "";
    this.#parser = new StreamingJsonParser();
    return { delta: void 0, arguments: this.append(text) };
  }
  /** The final arguments: one full parse of the complete text, which reports malformed arguments. */
  finish() {
    return parseToolCallArguments(this.#text);
  }
  #partial() {
    const snapshot = this.#parser.snapshot();
    if (snapshot === this.#snapshot)
      return this.#arguments;
    this.#snapshot = snapshot;
    this.#arguments = typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot) ? snapshot : {};
    return this.#arguments;
  }
};
var SIMPLE_ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	"
};
function isDelimiter(char) {
  return char === " " || char === "	" || char === "\n" || char === "\r" || char === "," || char === ":" || char === "{" || char === "}" || char === "[" || char === "]" || char === '"';
}
function isHexDigit(char) {
  return char >= "0" && char <= "9" || char >= "a" && char <= "f" || char >= "A" && char <= "F";
}
function scalarValue(token) {
  for (const [literal, value] of LITERALS)
    if (token === literal)
      return value;
  return NUMBER.test(token) ? Number(token) : void 0;
}
function pendingScalarValue(token) {
  for (const [literal, value] of LITERALS)
    if (literal.startsWith(token))
      return value;
  if (NUMBER.test(token))
    return Number(token);
  const mantissa = NUMBER_WITHOUT_EXPONENT_DIGITS.exec(token);
  return mantissa === null ? void 0 : Number(mantissa[1]);
}
function setSlot(container, slot, value) {
  if (slot.kind === "element")
    container[slot.index] = value;
  else if (slot.kind === "member")
    setMember(container, slot.key, value);
}
function setMember(members, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(members, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    members[key] = value;
  }
}

// node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.js
var UnsupportedStrictJsonSchemaError = class extends Error {
};
var UNSUPPORTED_STRICT_SCHEMA_KEYS = [
  "$ref",
  "$defs",
  "definitions",
  "allOf",
  "oneOf",
  "patternProperties",
  "dependentSchemas",
  "dependencies",
  "unevaluatedProperties",
  "propertyNames",
  "contains",
  "prefixItems",
  "not",
  "if",
  "then",
  "else"
];
function isJsonSchemaObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStructuredSchema(schema) {
  if (!isJsonSchemaObject(schema))
    return false;
  const types = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
  return types.includes("object") || types.includes("array") || schema.properties !== void 0 || schema.items !== void 0;
}
function schemaAllowsNull(schema) {
  if (!isJsonSchemaObject(schema))
    return false;
  if (schema.type === "null" || Array.isArray(schema.type) && schema.type.includes("null"))
    return true;
  if (schema.const === null || Array.isArray(schema.enum) && schema.enum.includes(null))
    return true;
  return Array.isArray(schema.anyOf) && schema.anyOf.some((variant) => schemaAllowsNull(variant));
}
function makeJsonSchemaNodeStrict(schema, isUnsupportedKeyword) {
  if (!isJsonSchemaObject(schema)) {
    throw new UnsupportedStrictJsonSchemaError("boolean schemas are unsupported");
  }
  for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) {
    if (schema[key] !== void 0) {
      throw new UnsupportedStrictJsonSchemaError(`${key} schemas are unsupported`);
    }
  }
  if (isUnsupportedKeyword) {
    for (const [key, value] of Object.entries(schema)) {
      if (isUnsupportedKeyword(key, value)) {
        throw new UnsupportedStrictJsonSchemaError(`${key}: ${JSON.stringify(value)} is unsupported`);
      }
    }
  }
  if (schema.anyOf !== void 0) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
      throw new UnsupportedStrictJsonSchemaError("anyOf must contain at least one schema");
    }
    for (const variant of schema.anyOf) {
      if (isStructuredSchema(variant)) {
        throw new UnsupportedStrictJsonSchemaError("object and array unions are unsupported");
      }
      makeJsonSchemaNodeStrict(variant, isUnsupportedKeyword);
    }
  }
  if (schema.items !== void 0) {
    if (Array.isArray(schema.items)) {
      throw new UnsupportedStrictJsonSchemaError("tuple schemas are unsupported");
    }
    makeJsonSchemaNodeStrict(schema.items, isUnsupportedKeyword);
  }
  const isObjectSchema = schema.type === "object";
  if (schema.properties !== void 0 && !isObjectSchema) {
    throw new UnsupportedStrictJsonSchemaError("properties require type object");
  }
  if (!isObjectSchema)
    return;
  if (schema.additionalProperties !== void 0 && schema.additionalProperties !== false) {
    throw new UnsupportedStrictJsonSchemaError("schema-valued or true additionalProperties is unsupported");
  }
  if (schema.properties !== void 0 && !isJsonSchemaObject(schema.properties)) {
    throw new UnsupportedStrictJsonSchemaError("object properties must be a schema map");
  }
  if (schema.required !== void 0 && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string"))) {
    throw new UnsupportedStrictJsonSchemaError("object required must be a string array");
  }
  const properties = schema.properties ?? {};
  const propertyNames = Object.keys(properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  if ([...required].some((key) => !propertyNames.includes(key))) {
    throw new UnsupportedStrictJsonSchemaError("required contains an unknown property");
  }
  for (const [key, property] of Object.entries(properties)) {
    makeJsonSchemaNodeStrict(property, isUnsupportedKeyword);
    if (!required.has(key) && !schemaAllowsNull(property)) {
      properties[key] = { anyOf: [property, { type: "null" }] };
    }
  }
  schema.required = propertyNames;
  schema.additionalProperties = false;
}
function makeStrictJsonSchema(schema, isUnsupportedKeyword) {
  const cloned = structuredClone(schema);
  if (!isJsonSchemaObject(cloned)) {
    throw new UnsupportedStrictJsonSchemaError("root schema must have type object");
  }
  makeJsonSchemaNodeStrict(cloned, isUnsupportedKeyword);
  if (cloned.type !== "object") {
    throw new UnsupportedStrictJsonSchemaError("root schema must have type object");
  }
  return cloned;
}
function getJsonSchemaToolParameters(tool, strict) {
  return strict === true ? makeStrictJsonSchema(tool.parameters) : tool.parameters;
}
function getGrammarToolInput(toolName, arguments_, inputProperty) {
  const input = arguments_[inputProperty];
  if (typeof input !== "string") {
    throw new Error(`Grammar tool call "${toolName}" requires argument "${inputProperty}" to be a string.`);
  }
  return input;
}
function appendGrammarToolInputJsonDelta(buffer, inputProperty, inputDelta) {
  if (buffer.closed) {
    throw new Error(`grammar tool input for property "${inputProperty}" changed after it was closed`);
  }
  if (inputDelta.length === 0)
    return void 0;
  buffer.input += inputDelta;
  return grammarToolInputJsonStart(buffer, inputProperty) + JSON.stringify(inputDelta).slice(1, -1);
}
function closeGrammarToolInputJson(buffer, inputProperty, finalInput) {
  if (buffer.closed) {
    if (finalInput === void 0 || finalInput === buffer.input)
      return void 0;
    throw new Error(`grammar tool input for property "${inputProperty}" changed after it was closed`);
  }
  if (finalInput !== void 0 && !finalInput.startsWith(buffer.input)) {
    throw new Error(`grammar tool input for property "${inputProperty}" changed non-monotonically`);
  }
  const rest = finalInput === void 0 ? "" : finalInput.slice(buffer.input.length);
  if (finalInput !== void 0)
    buffer.input = finalInput;
  buffer.closed = true;
  return `${grammarToolInputJsonStart(buffer, inputProperty)}${JSON.stringify(rest).slice(1, -1)}"}`;
}
function grammarToolInputJsonStart(buffer, inputProperty) {
  if (buffer.started)
    return "";
  buffer.started = true;
  return `{${JSON.stringify(inputProperty)}:"`;
}
function inferGrammarInputProperty(tool) {
  const schema = tool.parameters;
  if (schema.type !== "object") {
    throw new Error("grammar constrained sampling requires an object parameter schema");
  }
  if (!Array.isArray(schema.required) || schema.required.length !== 1 || typeof schema.required[0] !== "string") {
    throw new Error("grammar constrained sampling requires exactly one required string property");
  }
  const inputProperty = schema.required[0];
  if (!schema.properties?.[inputProperty]) {
    throw new Error(`grammar constrained sampling requires a properties entry for ${inputProperty}`);
  }
  if (schema.properties[inputProperty]?.type !== "string") {
    throw new Error(`grammar constrained sampling property ${inputProperty} must have type string`);
  }
  return inputProperty;
}
function resolveJsonSchemaStrictSampling(tool, supportsStrictMode, isUnsupportedKeyword) {
  const config = tool.constrainedSampling;
  if (!config || config.type !== "json_schema")
    return void 0;
  if (supportsStrictMode) {
    try {
      makeStrictJsonSchema(tool.parameters, isUnsupportedKeyword);
      return true;
    } catch (error) {
      if (!(error instanceof UnsupportedStrictJsonSchemaError))
        throw error;
      if (config.strict !== "require")
        return void 0;
      throw new Error(`Tool "${tool.name}" requires JSON-schema constrained sampling, but ${error.message}.`);
    }
  }
  if (config.strict === "require") {
    throw new Error(`Tool "${tool.name}" requires JSON-schema constrained sampling, but strict tools are unsupported.`);
  }
  return void 0;
}
function resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools) {
  const config = tool.constrainedSampling;
  if (!config || config.type !== "grammar") {
    return void 0;
  }
  if (!supportsOpenAIGrammarTools) {
    return void 0;
  }
  const larkDefinition = config.variants.openai_lark;
  const regexDefinition = config.variants.openai_regex;
  const hasLarkDefinition = typeof larkDefinition === "string" && larkDefinition.trim().length > 0;
  const hasRegexDefinition = typeof regexDefinition === "string" && regexDefinition.trim().length > 0;
  if (!hasLarkDefinition && !hasRegexDefinition) {
    throw new Error(`Tool "${tool.name}" cannot use grammar constrained sampling: no supported grammar variant was provided.`);
  }
  try {
    return {
      format: hasLarkDefinition ? "lark" : "regex",
      definition: hasLarkDefinition ? larkDefinition : regexDefinition,
      inputProperty: inferGrammarInputProperty(tool)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tool "${tool.name}" cannot use grammar constrained sampling: ${message}.`);
  }
}
function createGrammarToolInputProperties(tools, supportsOpenAIGrammarTools) {
  const properties = /* @__PURE__ */ new Map();
  for (const tool of tools ?? []) {
    const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);
    if (grammar) {
      properties.set(tool.name, grammar.inputProperty);
    }
  }
  return properties;
}

// node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js
var NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
var NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";
function replaceImagesWithPlaceholder(content, placeholder) {
  const result = [];
  let previousWasPlaceholder = false;
  for (const block of content) {
    if (block.type === "image") {
      if (!previousWasPlaceholder) {
        result.push({ type: "text", text: placeholder });
      }
      previousWasPlaceholder = true;
      continue;
    }
    result.push(block);
    previousWasPlaceholder = block.text === placeholder;
  }
  return result;
}
function downgradeUnsupportedImages(messages, model) {
  if (model.input.includes("image")) {
    return messages;
  }
  return messages.map((msg) => {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER)
      };
    }
    if (msg.role === "toolResult") {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER)
      };
    }
    return msg;
  });
}
function transformMessages(messages, model, normalizeToolCallId) {
  const toolCallIdMap = /* @__PURE__ */ new Map();
  const normalizedMessages = messages.map((msg) => msg.content == null ? { ...msg, content: [] } : msg);
  const imageAwareMessages = downgradeUnsupportedImages(normalizedMessages, model);
  const transformed = imageAwareMessages.map((msg) => {
    if (msg.role === "system" || msg.role === "user") {
      return msg;
    }
    if (msg.role === "toolResult") {
      const normalizedId = toolCallIdMap.get(msg.toolCallId);
      if (normalizedId && normalizedId !== msg.toolCallId) {
        return { ...msg, toolCallId: normalizedId };
      }
      return msg;
    }
    if (msg.role === "assistant") {
      const assistantMsg = msg;
      const isSameModel = assistantMsg.provider === model.provider && assistantMsg.api === model.api && assistantMsg.model === model.id;
      const transformedContent = assistantMsg.content.flatMap((block) => {
        if (block.type === "thinking") {
          if (!isSameModel)
            return [];
          if (block.redacted || block.thinkingSignature)
            return block;
          if (!block.thinking || block.thinking.trim() === "")
            return [];
          return block;
        }
        if (block.type === "text") {
          if (isSameModel)
            return block;
          return {
            type: "text",
            text: block.text
          };
        }
        if (block.type === "toolCall") {
          const toolCall = block;
          let normalizedToolCall = toolCall;
          if (!isSameModel && toolCall.thoughtSignature) {
            normalizedToolCall = { ...toolCall };
            delete normalizedToolCall.thoughtSignature;
          }
          if (!isSameModel && normalizeToolCallId) {
            const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
            if (normalizedId !== toolCall.id) {
              toolCallIdMap.set(toolCall.id, normalizedId);
              normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
            }
          }
          return normalizedToolCall;
        }
        return block;
      });
      return {
        ...assistantMsg,
        content: transformedContent
      };
    }
    return msg;
  });
  const result = [];
  let pendingToolCalls = [];
  let existingToolResultIds = /* @__PURE__ */ new Set();
  const heldSystemMessages = [];
  const closePendingToolCalls = () => {
    if (pendingToolCalls.length > 0) {
      for (const tc of pendingToolCalls) {
        if (!existingToolResultIds.has(tc.id)) {
          result.push({
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: "text", text: "No result provided" }],
            isError: true,
            timestamp: Date.now()
          });
        }
      }
      pendingToolCalls = [];
      existingToolResultIds = /* @__PURE__ */ new Set();
    }
    result.push(...heldSystemMessages);
    heldSystemMessages.length = 0;
  };
  for (let i = 0; i < transformed.length; i++) {
    const msg = transformed[i];
    if (msg.role === "assistant") {
      closePendingToolCalls();
      const assistantMsg = msg;
      if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
        continue;
      }
      const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
      if (toolCalls.length > 0) {
        pendingToolCalls = toolCalls;
        existingToolResultIds = /* @__PURE__ */ new Set();
      }
      result.push(msg);
    } else if (msg.role === "toolResult") {
      existingToolResultIds.add(msg.toolCallId);
      result.push(msg);
    } else if (msg.role === "system") {
      if (pendingToolCalls.length > 0) {
        heldSystemMessages.push(msg);
      } else {
        result.push(msg);
      }
    } else if (msg.role === "user") {
      closePendingToolCalls();
      result.push(msg);
    } else {
      result.push(msg);
    }
  }
  closePendingToolCalls();
  return result;
}

// node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js
function encodeTextSignatureV1(id, phase) {
  const payload = { v: 1, id };
  if (phase)
    payload.phase = phase;
  return JSON.stringify(payload);
}
function parseTextSignature(signature) {
  if (!signature)
    return void 0;
  if (signature.startsWith("{")) {
    try {
      const parsed = JSON.parse(signature);
      if (parsed.v === 1 && typeof parsed.id === "string") {
        if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
          return { id: parsed.id, phase: parsed.phase };
        }
        return { id: parsed.id };
      }
    } catch {
    }
  }
  return { id: signature };
}
function convertToolResultOutput(model, content) {
  const textResult = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const images = content.filter((c) => c.type === "image");
  const hasText = textResult.trim().length > 0;
  if (images.length === 0 || !model.input.includes("image")) {
    return sanitizeSurrogates(hasText ? textResult : images.length > 0 ? "(see attached image)" : "(no tool output)");
  }
  const output = [];
  if (hasText) {
    output.push({ type: "input_text", text: sanitizeSurrogates(textResult) });
  }
  for (const image of images) {
    output.push({
      type: "input_image",
      detail: "auto",
      image_url: `data:${image.mimeType};base64,${image.data}`
    });
  }
  return output;
}
function getResponsesToolSupport(options) {
  if (options.supportsMidConvoSystemMessages && options.supportsAdditionalTools)
    return "changes";
  return options.supportsToolSearch ? "additions" : "none";
}
function renderIncrementalToolsNotice(unavailable) {
  const notice = "This is an incremental tools update. Previously declared tools remain available unless explicitly marked unavailable. A tool declared again here is available again, and its latest definition replaces the earlier one.";
  return unavailable.size > 0 ? `${notice}
Still unavailable: ${[...unavailable].join(", ")}.` : notice;
}
function renderToolRemovalNotice(names) {
  return `The following tools are no longer available. Do not call them:
${names.map((name) => `- ${name}`).join("\n")}`;
}
function convertResponsesMessages(model, context, allowedToolCallProviders, options) {
  const normalizedContext = resolveTranscript(context, options?.supportsMidConvoSystemMessages);
  const messages = [];
  const normalizeIdPart = (part) => {
    const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
    const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
    return normalized.replace(/_+$/, "");
  };
  const buildForeignResponsesItemId = (itemId) => {
    const normalized = `fc_${shortHash(itemId)}`;
    return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
  };
  const normalizeToolCallId = (id, _targetModel, source) => {
    if (!allowedToolCallProviders.has(model.provider))
      return normalizeIdPart(id);
    if (!id.includes("|"))
      return normalizeIdPart(id);
    const [callId, itemId] = id.split("|");
    const normalizedCallId = normalizeIdPart(callId);
    const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;
    let normalizedItemId = isForeignToolCall ? buildForeignResponsesItemId(itemId) : normalizeIdPart(itemId);
    if (!normalizedItemId.startsWith("fc_")) {
      normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
    }
    return `${normalizedCallId}|${normalizedItemId}`;
  };
  const transformedMessages = transformMessages(normalizedContext.messages, model, normalizeToolCallId);
  const toolSupport = getResponsesToolSupport(options ?? {});
  const transcriptTools = resolveTranscriptTools(normalizedContext.messages, toolSupport);
  let declaredAdditionalTools = false;
  const unavailableTools = /* @__PURE__ */ new Set();
  const appendSystemToolAdditions = (message, seed) => {
    const tools = message.toolsAdded ?? [];
    for (const tool of tools)
      unavailableTools.delete(tool.name);
    if (tools.length === 0)
      return;
    if (toolSupport === "changes") {
      if (declaredAdditionalTools) {
        messages.push({ role: instructionRole, content: renderIncrementalToolsNotice(unavailableTools) });
      }
      declaredAdditionalTools = true;
      messages.push({
        type: "additional_tools",
        role: "developer",
        tools: convertResponsesTools(tools, options?.toolOptions)
      });
      return;
    }
    if (toolSupport !== "additions")
      return;
    const names = tools.map((tool) => tool.name);
    const callId = `pi_tool_load_${shortHash(`${seed}:${names.join(",")}`)}`;
    messages.push({
      type: "tool_search_call",
      call_id: callId,
      execution: "client",
      status: "completed",
      arguments: { query: names.join(" "), limit: names.length }
    });
    messages.push({
      type: "tool_search_output",
      call_id: callId,
      execution: "client",
      status: "completed",
      tools: convertResponsesTools(tools, { ...options?.toolOptions, toolSearchResult: true })
    });
  };
  const includeInitialSystemMessage = options?.includeSystemPrompt ?? true;
  const pushConfigurationUpdate = (effort) => {
    messages.push({
      type: "configuration_update",
      reasoning: { effort }
    });
  };
  const compat = model.compat;
  const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";
  let msgIndex = 0;
  let sourceIndex = 0;
  let systemIndex = 0;
  for (const msg of transformedMessages) {
    const isLeadingSystemMessage = sourceIndex++ === 0 && msg.role === "system";
    if (msg.role === "system") {
      const anchorsToolChanges = systemIndex++ >= transcriptTools.foldedSystemMessages;
      if (anchorsToolChanges)
        appendSystemToolAdditions(msg, `system:${msgIndex}`);
      if (!isLeadingSystemMessage || includeInitialSystemMessage) {
        const parts = [isLeadingSystemMessage ? getSystemMessageText(msg) : renderSystemMessageUpdate(msg)];
        if (anchorsToolChanges) {
          const added = new Set((msg.toolsAdded ?? []).map((tool) => tool.name));
          const removed = (msg.toolsRemoved ?? []).map((tool) => tool.name).filter((name) => !added.has(name));
          if (removed.length > 0)
            parts.push(renderToolRemovalNotice(removed));
          for (const name of removed)
            unavailableTools.add(name);
        }
        const text = parts.filter((part) => part.length > 0).join("\n\n");
        if (text.length > 0) {
          messages.push({ role: instructionRole, content: sanitizeSurrogates(text) });
        }
      }
    } else if (msg.role === "user") {
      if (typeof msg.content === "string") {
        messages.push({
          role: "user",
          content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }]
        });
      } else {
        const content = msg.content.map((item) => {
          if (item.type === "text") {
            return {
              type: "input_text",
              text: sanitizeSurrogates(item.text)
            };
          }
          return {
            type: "input_image",
            detail: "auto",
            image_url: `data:${item.mimeType};base64,${item.data}`
          };
        });
        if (content.length === 0)
          continue;
        messages.push({
          role: "user",
          content
        });
      }
    } else if (msg.role === "assistant") {
      const output = [];
      const assistantMsg = msg;
      const isSameProviderAndApi = assistantMsg.provider === model.provider && assistantMsg.api === model.api;
      const isSameModel = isSameProviderAndApi && assistantMsg.model === model.id;
      const isDifferentModel = isSameProviderAndApi && assistantMsg.model !== model.id;
      let textBlockIndex = 0;
      for (const block of msg.content) {
        if (block.type === "thinking") {
          if (block.thinkingSignature) {
            const reasoningItem = JSON.parse(block.thinkingSignature);
            output.push(reasoningItem);
          }
        } else if (block.type === "text") {
          const textBlock = block;
          const parsedSignature = parseTextSignature(textBlock.textSignature);
          const fallbackMessageId = textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;
          textBlockIndex++;
          let msgId = parsedSignature?.id;
          if (!msgId) {
            msgId = fallbackMessageId;
          } else if (msgId.length > 64) {
            msgId = `msg_${shortHash(msgId)}`;
          }
          output.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: sanitizeSurrogates(textBlock.text), annotations: [] }],
            status: "completed",
            id: msgId,
            phase: parsedSignature?.phase
          });
        } else if (block.type === "toolCall") {
          const toolCall = block;
          const [callId, itemIdRaw] = toolCall.id.split("|");
          const customInputProperty = options?.grammarToolInputProperties?.get(toolCall.name);
          let itemId = itemIdRaw;
          const itemIdPrefix = customInputProperty === void 0 ? "fc_" : "ctc_";
          if (isDifferentModel || !itemId?.startsWith(itemIdPrefix)) {
            itemId = void 0;
          }
          if (customInputProperty !== void 0) {
            output.push({
              type: "custom_tool_call",
              id: itemId,
              call_id: callId,
              name: toolCall.name,
              input: sanitizeSurrogates(getGrammarToolInput(toolCall.name, toolCall.arguments, customInputProperty)),
              ...isSameModel && toolCall.namespace !== void 0 ? { namespace: toolCall.namespace } : {}
            });
          } else {
            output.push({
              type: "function_call",
              id: itemId,
              call_id: callId,
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
              ...isSameModel && toolCall.namespace !== void 0 ? { namespace: toolCall.namespace } : {}
            });
          }
        }
      }
      if (output.length === 0)
        continue;
      if (options?.configurationUpdateEffort !== void 0 && isSameModel && msg.providerThinkingLevel !== void 0) {
        pushConfigurationUpdate(msg.providerThinkingLevel);
      }
      messages.push(...output);
    } else if (msg.role === "toolResult") {
      const [callId] = msg.toolCallId.split("|");
      const output = convertToolResultOutput(model, msg.content);
      if (options?.grammarToolInputProperties?.has(msg.toolName)) {
        messages.push({
          type: "custom_tool_call_output",
          call_id: callId,
          output
        });
      } else {
        messages.push({
          type: "function_call_output",
          call_id: callId,
          output
        });
      }
    }
    if (!isLeadingSystemMessage)
      msgIndex++;
  }
  if (options?.configurationUpdateEffort !== void 0)
    pushConfigurationUpdate(options.configurationUpdateEffort);
  return messages;
}
function convertResponsesTools(tools, options) {
  const defaultStrict = options?.strict === void 0 ? false : options.strict;
  const supportsStrictMode = options?.supportsStrictMode ?? true;
  const supportsOpenAIGrammarTools = options?.supportsOpenAIGrammarTools ?? false;
  return tools.map((tool) => {
    const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);
    if (grammar) {
      return {
        type: "custom",
        name: tool.name,
        description: tool.description,
        format: {
          type: "grammar",
          syntax: grammar.format,
          definition: grammar.definition
        },
        ...options?.toolSearchResult ? { defer_loading: true } : {}
      };
    }
    const constrainedStrict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
    const strict = constrainedStrict ?? defaultStrict;
    const functionTool = {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: getJsonSchemaToolParameters(tool, strict === true),
      ...options?.toolSearchResult ? { defer_loading: true } : {}
    };
    if (supportsStrictMode) {
      functionTool.strict = strict;
    }
    return functionTool;
  });
}
async function processResponsesStream(openaiStream, output, stream, model, options) {
  let sawTerminalResponseEvent = false;
  const outputSlots = /* @__PURE__ */ new Map();
  const unfinishedToolCalls = /* @__PURE__ */ new Set();
  const reasoningBlocksById = /* @__PURE__ */ new Map();
  const applyMessagePhaseStopReason = (item) => {
    if (item.type === "message" && item.phase === "final_answer") {
      output.stopReason = "stop";
    }
  };
  const getSlot = (outputIndex, type) => {
    const slot = outputSlots.get(outputIndex);
    return slot?.type === type ? slot : void 0;
  };
  const pushToolCallDelta = (slot, delta) => {
    if (delta === void 0)
      return;
    stream.push({
      type: "toolcall_delta",
      contentIndex: slot.contentIndex,
      delta,
      partial: output
    });
  };
  const createSlot = (outputIndex, item) => {
    if (item.type === "reasoning") {
      const block = { type: "thinking", thinking: "" };
      output.content.push(block);
      const slot = {
        type: "thinking",
        block,
        contentIndex: output.content.length - 1
      };
      outputSlots.set(outputIndex, slot);
      stream.push({ type: "thinking_start", contentIndex: slot.contentIndex, partial: output });
      return slot;
    }
    if (item.type === "message") {
      applyMessagePhaseStopReason(item);
      const block = { type: "text", text: "" };
      output.content.push(block);
      const slot = { type: "text", block, contentIndex: output.content.length - 1 };
      outputSlots.set(outputIndex, slot);
      stream.push({ type: "text_start", contentIndex: slot.contentIndex, partial: output });
      return slot;
    }
    if (item.type === "function_call") {
      const args = new ToolCallArgumentsStream();
      const block = {
        type: "toolCall",
        id: `${item.call_id}|${item.id}`,
        name: item.name,
        arguments: item.arguments ? args.append(item.arguments) : {},
        ...item.namespace !== void 0 ? { namespace: item.namespace } : {}
      };
      output.content.push(block);
      unfinishedToolCalls.add(block);
      const slot = {
        type: "toolCall",
        block,
        contentIndex: output.content.length - 1,
        input: { kind: "json", arguments: args }
      };
      outputSlots.set(outputIndex, slot);
      stream.push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial: output });
      return slot;
    }
    if (item.type === "custom_tool_call") {
      const inputProperty = options?.grammarToolInputProperties?.get(item.name) ?? "input";
      const input = item.input || "";
      const block = {
        type: "toolCall",
        id: `${item.call_id}|${item.id}`,
        name: item.name,
        arguments: { [inputProperty]: input },
        ...item.namespace !== void 0 ? { namespace: item.namespace } : {}
      };
      output.content.push(block);
      unfinishedToolCalls.add(block);
      const slot = {
        type: "toolCall",
        block,
        contentIndex: output.content.length - 1,
        input: customInput(inputProperty, input)
      };
      outputSlots.set(outputIndex, slot);
      stream.push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial: output });
      return slot;
    }
    return void 0;
  };
  const getOrCreateSlot = (outputIndex, item) => {
    return outputSlots.get(outputIndex) ?? createSlot(outputIndex, item);
  };
  const backfillReasoningSignatures = (responseOutput) => {
    for (const item of responseOutput) {
      if (item.type !== "reasoning" || !item.encrypted_content)
        continue;
      const block = reasoningBlocksById.get(item.id);
      if (!block?.thinkingSignature)
        continue;
      const storedItem = JSON.parse(block.thinkingSignature);
      if (storedItem.encrypted_content)
        continue;
      block.thinkingSignature = JSON.stringify({
        ...storedItem,
        encrypted_content: item.encrypted_content
      });
    }
  };
  const finalizeResponse = (response) => {
    sawTerminalResponseEvent = true;
    backfillReasoningSignatures(response.output ?? []);
    if (response?.id) {
      output.responseId = response.id;
    }
    if (response?.usage) {
      const inputDetails = response.usage.input_tokens_details;
      const cachedTokens = inputDetails?.cached_tokens || 0;
      const cacheWriteTokens = inputDetails?.cache_write_tokens || 0;
      output.usage = {
        // OpenAI includes cached and cache-write tokens in input_tokens, so subtract both.
        input: Math.max(0, (response.usage.input_tokens || 0) - cachedTokens - cacheWriteTokens),
        output: response.usage.output_tokens || 0,
        cacheRead: cachedTokens,
        cacheWrite: cacheWriteTokens,
        reasoning: response.usage.output_tokens_details?.reasoning_tokens || 0,
        totalTokens: response.usage.total_tokens || 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      };
    }
    calculateCost(model, output.usage);
    if (options?.applyServiceTierPricing) {
      const serviceTier = options.resolveServiceTier ? options.resolveServiceTier(response?.service_tier, options.serviceTier) : response?.service_tier ?? options.serviceTier;
      options.applyServiceTierPricing(output.usage, serviceTier);
    }
    const status = response?.status;
    const incompleteDetails = response?.incomplete_details;
    const incompleteReason = typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : void 0;
    output.rawStopReason = incompleteReason ? `${status}.${incompleteReason}` : status;
    const mappedStop = mapStopReason(status, incompleteReason);
    output.stopReason = mappedStop.stopReason;
    if (mappedStop.errorMessage === void 0)
      delete output.errorMessage;
    else
      output.errorMessage = mappedStop.errorMessage;
    if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
      output.stopReason = "toolUse";
    }
  };
  for await (const event of openaiStream) {
    await options?.onProviderStreamEvent?.(event, model);
    if (event.type === "response.created") {
      output.responseId = event.response.id;
    } else if (event.type === "response.output_item.added") {
      createSlot(event.output_index, event.item);
    } else if (event.type === "response.reasoning_summary_text.delta") {
      const slot = getSlot(event.output_index, "thinking");
      if (!slot)
        continue;
      slot.block.thinking += event.delta;
      stream.push({
        type: "thinking_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output
      });
    } else if (event.type === "response.reasoning_summary_part.done") {
      const slot = getSlot(event.output_index, "thinking");
      if (!slot)
        continue;
      slot.block.thinking += "\n\n";
      stream.push({
        type: "thinking_delta",
        contentIndex: slot.contentIndex,
        delta: "\n\n",
        partial: output
      });
    } else if (event.type === "response.reasoning_text.delta") {
      const slot = getSlot(event.output_index, "thinking");
      if (!slot)
        continue;
      slot.block.thinking += event.delta;
      stream.push({
        type: "thinking_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output
      });
    } else if (event.type === "response.output_text.delta") {
      const slot = getSlot(event.output_index, "text");
      if (!slot)
        continue;
      slot.block.text += event.delta;
      stream.push({
        type: "text_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output
      });
    } else if (event.type === "response.refusal.delta") {
      const slot = getSlot(event.output_index, "text");
      if (!slot)
        continue;
      slot.block.text += event.delta;
      stream.push({
        type: "text_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output
      });
    } else if (event.type === "response.function_call_arguments.delta") {
      const slot = getSlot(event.output_index, "toolCall");
      if (slot?.input.kind !== "json")
        continue;
      slot.block.arguments = slot.input.arguments.append(event.delta);
      pushToolCallDelta(slot, event.delta);
    } else if (event.type === "response.function_call_arguments.done") {
      const slot = getSlot(event.output_index, "toolCall");
      if (slot?.input.kind !== "json")
        continue;
      const replaced = slot.input.arguments.replace(event.arguments);
      slot.block.arguments = replaced.arguments;
      if (replaced.delta)
        pushToolCallDelta(slot, replaced.delta);
    } else if (event.type === "response.custom_tool_call_input.delta") {
      const slot = getSlot(event.output_index, "toolCall");
      if (slot?.input.kind !== "custom")
        continue;
      pushToolCallDelta(slot, appendCustomInput(slot.block, slot.input, event.delta));
    } else if (event.type === "response.custom_tool_call_input.done") {
      const slot = getSlot(event.output_index, "toolCall");
      if (slot?.input.kind !== "custom")
        continue;
      pushToolCallDelta(slot, closeCustomInput(slot.block, slot.input, event.input));
    } else if (event.type === "response.output_item.done") {
      const item = event.item;
      applyMessagePhaseStopReason(item);
      const slot = getOrCreateSlot(event.output_index, item);
      if (item.type === "reasoning" && slot?.type === "thinking") {
        const summaryText = item.summary?.map((s) => s.text).join("\n\n") || "";
        const contentText2 = item.content?.map((c) => c.text).join("\n\n") || "";
        slot.block.thinking = summaryText || contentText2 || slot.block.thinking;
        slot.block.thinkingSignature = JSON.stringify(item);
        reasoningBlocksById.set(item.id, slot.block);
        stream.push({
          type: "thinking_end",
          contentIndex: slot.contentIndex,
          content: slot.block.thinking,
          partial: output
        });
        outputSlots.delete(event.output_index);
      } else if (item.type === "message" && slot?.type === "text") {
        slot.block.text = item.content?.map((c) => c.type === "output_text" ? c.text : c.refusal).join("") || "";
        slot.block.textSignature = encodeTextSignatureV1(item.id, item.phase ?? void 0);
        stream.push({
          type: "text_end",
          contentIndex: slot.contentIndex,
          content: slot.block.text,
          partial: output
        });
        outputSlots.delete(event.output_index);
      } else if (item.type === "function_call" && slot?.type === "toolCall" && slot.input.kind === "json") {
        if (item.arguments)
          slot.input.arguments.replace(item.arguments);
        Object.assign(slot.block, slot.input.arguments.finish());
        if (item.namespace !== void 0)
          slot.block.namespace = item.namespace;
        unfinishedToolCalls.delete(slot.block);
        stream.push({
          type: "toolcall_end",
          contentIndex: slot.contentIndex,
          toolCall: slot.block,
          partial: output
        });
        outputSlots.delete(event.output_index);
      } else if (item.type === "custom_tool_call" && slot?.type === "toolCall" && slot.input.kind === "custom") {
        pushToolCallDelta(slot, closeCustomInput(slot.block, slot.input, item.input));
        if (item.namespace !== void 0)
          slot.block.namespace = item.namespace;
        unfinishedToolCalls.delete(slot.block);
        stream.push({
          type: "toolcall_end",
          contentIndex: slot.contentIndex,
          toolCall: slot.block,
          partial: output
        });
        outputSlots.delete(event.output_index);
      }
    } else if (event.type === "response.completed" || event.type === "response.incomplete") {
      finalizeResponse(event.response);
    } else if (event.type === "error") {
      throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
    } else if (event.type === "response.failed") {
      sawTerminalResponseEvent = true;
      output.rawStopReason = event.response?.status;
      const error = event.response?.error;
      const details = event.response?.incomplete_details;
      const msg = error ? `${error.code || "unknown"}: ${error.message || "no message"}` : details?.reason ? `incomplete: ${details.reason}` : "Unknown error (no error details in response)";
      throw new Error(msg);
    }
  }
  if (!sawTerminalResponseEvent) {
    throw new Error("OpenAI Responses stream ended before a terminal response event");
  }
  if (output.stopReason === "toolUse") {
    for (const toolCall of unfinishedToolCalls) {
      throw new Error(`OpenAI Responses stream completed with an unfinished tool call: ${toolCall.name} (${toolCall.id})`);
    }
  }
}
function customInput(property, initialInput) {
  const buffer = { input: "", started: false, closed: false };
  return {
    kind: "custom",
    property,
    buffer,
    unsent: appendGrammarToolInputJsonDelta(buffer, property, initialInput) ?? ""
  };
}
function appendCustomInput(block, input, delta) {
  return sendCustomInput(block, input, appendGrammarToolInputJsonDelta(input.buffer, input.property, delta));
}
function closeCustomInput(block, input, finalInput) {
  return sendCustomInput(block, input, closeGrammarToolInputJson(input.buffer, input.property, finalInput));
}
function sendCustomInput(block, input, jsonDelta) {
  block.arguments = { [input.property]: input.buffer.input };
  if (input.unsent === "")
    return jsonDelta;
  const sent = input.unsent + (jsonDelta ?? "");
  input.unsent = "";
  return sent;
}
function mapStopReason(status, incompleteReason) {
  if (!status)
    return { stopReason: "stop" };
  switch (status) {
    case "completed":
      return { stopReason: "stop" };
    case "incomplete":
      if (incompleteReason === "max_output_tokens") {
        return { stopReason: "length" };
      }
      return {
        stopReason: "error",
        errorMessage: incompleteReason ? `Response incomplete: ${incompleteReason}` : "Response incomplete without a provider reason"
      };
    case "failed":
    case "cancelled":
      return { stopReason: "error" };
    // These two are wonky ...
    case "in_progress":
    case "queued":
      return { stopReason: "stop" };
    default: {
      const _exhaustive = status;
      throw new Error(`Unhandled stop reason: ${_exhaustive}`);
    }
  }
}

// node_modules/@earendil-works/pi-ai/dist/api/openai-prompt-cache.js
var OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;
function clampOpenAIPromptCacheKey(key) {
  if (key === void 0)
    return void 0;
  const chars = Array.from(key);
  if (chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH)
    return key;
  return chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("");
}

// node_modules/@earendil-works/pi-ai/dist/api/github-copilot-headers.js
function inferCopilotInitiator(messages) {
  const last = messages[messages.length - 1];
  return last && last.role !== "user" ? "agent" : "user";
}
function hasCopilotVisionInput(messages) {
  return messages.some((msg) => {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      return msg.content.some((c) => c.type === "image");
    }
    if (msg.role === "toolResult" && Array.isArray(msg.content)) {
      return msg.content.some((c) => c.type === "image");
    }
    return false;
  });
}
function buildCopilotDynamicHeaders(params) {
  const headers = {
    "X-Initiator": inferCopilotInitiator(params.messages),
    "Openai-Intent": "conversation-edits"
  };
  if (params.hasImages) {
    headers["Copilot-Vision-Request"] = "true";
  }
  return headers;
}

// node_modules/@earendil-works/pi-ai/dist/providers/opencode-headers.js
var OPENCODE_SESSION_HEADER = "x-opencode-session";
function hasHeader(headers, name) {
  const expected = name.toLowerCase();
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === expected);
}
function withSessionHeader(options) {
  if (!options?.sessionId || hasHeader(options.headers, OPENCODE_SESSION_HEADER))
    return options;
  return {
    ...options,
    headers: { ...options.headers, [OPENCODE_SESSION_HEADER]: options.sessionId }
  };
}
function withOpenCodeSessionHeader(streams) {
  return {
    ...streams,
    stream: (model, context, options) => streams.stream(model, context, withSessionHeader(options)),
    streamSimple: (model, context, options) => streams.streamSimple(model, context, withSessionHeader(options))
  };
}

// src/pi-responses-runtime.ts
var RESPONSE_CATALOGS = {
  "cloudflare-ai-gateway": CLOUDFLARE_AI_GATEWAY_MODELS,
  "github-copilot": GITHUB_COPILOT_MODELS,
  openai: OPENAI_MODELS,
  opencode: OPENCODE_MODELS,
  "opencode-go": OPENCODE_GO_MODELS,
  xai: XAI_MODELS
};
function getCatalogModels(provider) {
  return Object.hasOwn(RESPONSE_CATALOGS, provider) ? Object.values(RESPONSE_CATALOGS[provider]).filter(
    // Pi 1.x catalogs may also hold image / classifier models; only chat models are routable here.
    (model) => model.type === void 0 || model.type === "chat"
  ) : [];
}
export {
  buildCopilotDynamicHeaders,
  clampOpenAIPromptCacheKey,
  convertResponsesMessages,
  convertResponsesTools,
  createAssistantMessageEventStream,
  createGrammarToolInputProperties,
  getCatalogModels,
  getResponsesToolSupport,
  getSupportedThinkingLevels,
  hasCopilotVisionInput,
  normalizeContext,
  processResponsesStream,
  resolveTranscript,
  resolveTranscriptTools,
  withOpenCodeSessionHeader
};
