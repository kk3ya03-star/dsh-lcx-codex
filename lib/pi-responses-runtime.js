// Generated from public @earendil-works/pi-ai@0.85.1 by scripts/build-pi-runtime.mjs. Do not edit.
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

// scripts/runtime-dsh015/node_modules/partial-json/dist/options.js
var require_options = __commonJS({
  "scripts/runtime-dsh015/node_modules/partial-json/dist/options.js"(exports) {
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

// scripts/runtime-dsh015/node_modules/partial-json/dist/index.js
var require_dist = __commonJS({
  "scripts/runtime-dsh015/node_modules/partial-json/dist/index.js"(exports) {
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

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/data/cloudflare-ai-gateway.json
var cloudflare_ai_gateway_default = { "anthropic-messages": { "claude-fable-5": { id: "claude-fable-5", name: "Claude Fable 5", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" } }, "claude-fable-5.1": { id: "claude-fable-5.1", name: "Claude Fable 5.1", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" } }, "claude-haiku-4.5": { id: "claude-haiku-4.5", name: "Claude Haiku 4.5 (latest)", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, contextWindow: 2e5, maxTokens: 64e3, compat: { sendSessionAffinityHeaders: true } }, "claude-opus-4.5": { id: "claude-opus-4.5", name: "Claude Opus 4.5 (latest)", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 2e5, maxTokens: 64e3, compat: { sendSessionAffinityHeaders: true } }, "claude-opus-4.6": { id: "claude-opus-4.6", name: "Claude Opus 4.6", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { max: "max" } }, "claude-opus-4.7": { id: "claude-opus-4.7", name: "Claude Opus 4.7", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" } }, "claude-opus-4.8": { id: "claude-opus-4.8", name: "Claude Opus 4.8", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" } }, "claude-opus-5": { id: "claude-opus-5", name: "Claude Opus 5", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true, supportsTemperature: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" } }, "claude-sonnet-4.5": { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5 (latest)", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 1e6, maxTokens: 64e3, compat: { sendSessionAffinityHeaders: true } }, "claude-sonnet-4.6": { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { max: "max" } }, "claude-sonnet-5": { id: "claude-sonnet-5", name: "Claude Sonnet 5", api: "anthropic-messages", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 128e3, compat: { sendSessionAffinityHeaders: true, forceAdaptiveThinking: true }, thinkingLevelMap: { xhigh: "xhigh", max: "max" } } }, "openai-completions": { "workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731": { id: "workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 0731", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0 }, contextWindow: 1310720, maxTokens: 1048576, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true, requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" } }, "workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813": { id: "workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 1048576, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true, requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" } }, "workers-ai/@cf/google/gemma-4-26b-a4b-it": { id: "workers-ai/@cf/google/gemma-4-26b-a4b-it", name: "Gemma 4 26B A4B IT", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 16384, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/ibm-granite/granite-4.0-h-micro": { id: "workers-ai/@cf/ibm-granite/granite-4.0-h-micro", name: "Granite 4.0 H Micro", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: false, input: ["text"], cost: { input: 0.017, output: 0.112, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131e3, maxTokens: 131e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast": { id: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct fp8 Fast", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: false, input: ["text"], cost: { input: 0.293, output: 2.253, cacheRead: 0, cacheWrite: 0 }, contextWindow: 24e3, maxTokens: 24e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct": { id: "workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B 16E Instruct", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: false, input: ["text", "image"], cost: { input: 0.27, output: 0.85, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131e3, maxTokens: 16384, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct": { id: "workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1 24B Instruct", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: false, input: ["text"], cost: { input: 0.351, output: 0.555, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/moonshotai/kimi-k2.6": { id: "workers-ai/@cf/moonshotai/kimi-k2.6", name: "Kimi K2.6", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 256e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/moonshotai/kimi-k2.7-code": { id: "workers-ai/@cf/moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 262144, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/nvidia/nemotron-3-120b-a12b": { id: "workers-ai/@cf/nvidia/nemotron-3-120b-a12b", name: "Nemotron 3 Super 120B", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 256e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/openai/gpt-oss-120b": { id: "workers-ai/@cf/openai/gpt-oss-120b", name: "GPT OSS 120B", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.35, output: 0.75, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/openai/gpt-oss-20b": { id: "workers-ai/@cf/openai/gpt-oss-20b", name: "GPT OSS 20B", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.2, output: 0.3, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/qwen/qwen3-30b-a3b-fp8": { id: "workers-ai/@cf/qwen/qwen3-30b-a3b-fp8", name: "Qwen3 30B A3b fp8", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.0509, output: 0.335, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 32768, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/qwen/qwen3.8-27b": { id: "workers-ai/@cf/qwen/qwen3.8-27b", name: "Qwen3.8 27B", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.45, output: 3.2, cacheRead: 0.05, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 262144, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/zai-org/glm-4.7-flash": { id: "workers-ai/@cf/zai-org/glm-4.7-flash", name: "GLM-4.7-Flash", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 0.0605, output: 0.4, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 131072, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/zai-org/glm-5.2": { id: "workers-ai/@cf/zai-org/glm-5.2", name: "Glm 5.2", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 256e3, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/zai-org/glm-5.3": { id: "workers-ai/@cf/zai-org/glm-5.3", name: "Glm 5.3", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, contextWindow: 1310720, maxTokens: 1310720, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } }, "workers-ai/@cf/zai-org/glm-5.3-flash": { id: "workers-ai/@cf/zai-org/glm-5.3-flash", name: "Glm 5.3 Flash", api: "openai-completions", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 }, contextWindow: 1310720, maxTokens: 1048576, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsStrictMode: false, supportsLongCacheRetention: false, sendSessionAffinityHeaders: true } } }, "openai-responses": { "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true } }, "gpt-4.1-mini": { id: "gpt-4.1-mini", name: "GPT-4.1 mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true } }, "gpt-4.1-nano": { id: "gpt-4.1-nano", name: "GPT-4.1 nano", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 32768, compat: { supportsStrictMode: true } }, "gpt-4o": { id: "gpt-4o", name: "GPT-4o", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 1.25, output: 5, cacheRead: 0.625, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true } }, "gpt-4o-mini": { id: "gpt-4o-mini", name: "GPT-4o mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: false, input: ["text", "image"], cost: { input: 0.075, output: 0.3, cacheRead: 0.0375, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true } }, "gpt-5": { id: "gpt-5", name: "GPT-5", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 Mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.05, output: 0.4, cacheRead: 5e-3, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.1": { id: "gpt-5.1", name: "GPT-5.1", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.4-nano": { id: "gpt-5.4-nano", name: "GPT-5.4 nano", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.4-pro": { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 30, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.5-pro": { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tiers: [{ inputTokensAbove: 272e3, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.25, cacheWrite: 3.125 }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, o3: { id: "o3", name: "o3", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true } }, "o3-mini": { id: "o3-mini", name: "o3-mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text"], cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true } }, "o4-mini": { id: "o4-mini", name: "o4-mini", api: "openai-responses", provider: "cloudflare-ai-gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai", reasoning: true, input: ["text", "image"], cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true } } } };

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/model-catalog.js
function flattenModelCatalog(_provider, groups) {
  return Object.assign({}, ...Object.values(groups));
}

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/cloudflare-ai-gateway.models.js
var CLOUDFLARE_AI_GATEWAY_MODELS = flattenModelCatalog("cloudflare-ai-gateway", cloudflare_ai_gateway_default);

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/data/github-copilot.json
var github_copilot_default = { "anthropic-messages": { "claude-fable-5": { id: "claude-fable-5", name: "Claude Fable 5", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true } }, "claude-fable-5.1": { id: "claude-fable-5.1", name: "Claude Fable 5.1", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true } }, "claude-haiku-4.5": { id: "claude-haiku-4.5", name: "Claude Haiku 4.5 (latest)", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, contextWindow: 2e5, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsEagerToolInputStreaming: false } }, "claude-opus-4.7": { id: "claude-opus-4.7", name: "Claude Opus 4.7", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 32e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false } }, "claude-opus-4.8": { id: "claude-opus-4.8", name: "Claude Opus 4.8", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false } }, "claude-opus-5": { id: "claude-opus-5", name: "Claude Opus 5", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false } }, "claude-sonnet-4.6": { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 1e6, maxTokens: 32e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { max: "max", minimal: "low" }, compat: { forceAdaptiveThinking: true } }, "claude-sonnet-5": { id: "claude-sonnet-5", name: "Claude Sonnet 5", api: "anthropic-messages", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true } } }, "openai-completions": { "gemini-3.5-flash": { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false } }, "gemini-3.6-flash": { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false } }, "gemini-3.7-flash": { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false } }, "gemini-3.8-flash": { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false } }, "gpt-6-astra": { id: "gpt-6-astra", name: "GPT-6 Astra", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, tiers: [{ inputTokensAbove: 272e3, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }] }, contextWindow: 105e4, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" } }, "kimi-k2.7-code": { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 32e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false } }, "kimi-k3": { id: "kimi-k3", name: "Kimi K3", api: "openai-completions", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 131072, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false } } }, "openai-responses": { "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 Mini", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 264e3, maxTokens: 64e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsOpenAIGrammarTools: true } }, "gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsOpenAIGrammarTools: true } }, "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: 0 }] }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsOpenAIGrammarTools: true } }, "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 mini", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsOpenAIGrammarTools: true } }, "gpt-5.4-nano": { id: "gpt-5.4-nano", name: "GPT-5.4 nano", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", xhigh: "xhigh" }, compat: { supportsOpenAIGrammarTools: true } }, "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 10, output: 45, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 1e6, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsOpenAIGrammarTools: true } }, "gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tiers: [{ inputTokensAbove: 2e5, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }] }, contextWindow: 105e4, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsOpenAIGrammarTools: true } }, "gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [{ inputTokensAbove: 272e3, input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10 }] }, contextWindow: 105e4, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsOpenAIGrammarTools: true } }, "gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 105e4, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsOpenAIGrammarTools: true } }, "grok-4.5": { id: "grok-4.5", name: "Grok 4.5", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "grok-4.6": { id: "grok-4.6", name: "Grok 4.6", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 2e5, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 5e5, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "mai-code-1-flash-picker": { id: "mai-code-1-flash-picker", name: "MAI-Code-1-Flash", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text"], cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "mai-code-1.1-flash": { id: "mai-code-1.1-flash", name: "MAI-Code-1.1-Flash", api: "openai-responses", provider: "github-copilot", baseUrl: "https://api.individual.githubcopilot.com", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0 }, contextWindow: 256e3, maxTokens: 128e3, headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" }, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } } } };

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/github-copilot.models.js
var GITHUB_COPILOT_MODELS = flattenModelCatalog("github-copilot", github_copilot_default);

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/data/openai.json
var openai_default = { "openai-responses": { "gpt-4": { id: "gpt-4", name: "GPT-4", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text"], cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 8192, compat: { supportsStrictMode: true } }, "gpt-4-turbo": { id: "gpt-4-turbo", name: "GPT-4 Turbo", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 4096, compat: { supportsStrictMode: true } }, "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true } }, "gpt-4.1-mini": { id: "gpt-4.1-mini", name: "GPT-4.1 mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true } }, "gpt-4.1-nano": { id: "gpt-4.1-nano", name: "GPT-4.1 nano", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 1047576, maxTokens: 32768, compat: { supportsStrictMode: true } }, "gpt-4o": { id: "gpt-4o", name: "GPT-4o", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true } }, "gpt-4o-2024-05-13": { id: "gpt-4o-2024-05-13", name: "GPT-4o (2024-05-13)", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 4096, compat: { supportsStrictMode: true } }, "gpt-4o-2024-08-06": { id: "gpt-4o-2024-08-06", name: "GPT-4o (2024-08-06)", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true } }, "gpt-4o-2024-11-20": { id: "gpt-4o-2024-11-20", name: "GPT-4o (2024-11-20)", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true } }, "gpt-4o-mini": { id: "gpt-4o-mini", name: "GPT-4o mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, compat: { supportsStrictMode: true } }, "gpt-5": { id: "gpt-5", name: "GPT-5", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5-chat-latest": { id: "gpt-5-chat-latest", name: "GPT-5 Chat Latest", api: "openai-responses", baseUrl: "https://api.openai.com/v1", provider: "openai", reasoning: false, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, thinkingLevelMap: { off: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 Mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.05, output: 0.4, cacheRead: 5e-3, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5-pro": { id: "gpt-5-pro", name: "GPT-5 Pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 15, output: 120, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.1": { id: "gpt-5.1", name: "GPT-5.1", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.2-chat-latest": { id: "gpt-5.2-chat-latest", name: "GPT-5.2 Chat", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: null, xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.2-pro": { id: "gpt-5.2-pro", name: "GPT-5.2 Pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 21, output: 168, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.3-chat-latest": { id: "gpt-5.3-chat-latest", name: "GPT-5.3 Chat (latest)", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 16384, thinkingLevelMap: { off: null, xhigh: "xhigh" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.3-codex-spark": { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 32e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: 0 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true } }, "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true } }, "gpt-5.4-nano": { id: "gpt-5.4-nano", name: "GPT-5.4 nano", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.4-pro": { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 60, output: 270, cacheRead: 0, cacheWrite: 0 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true } }, "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 10, output: 45, cacheRead: 1, cacheWrite: 0 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true } }, "gpt-5.5-pro": { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: 272e3, input: 60, output: 270, cacheRead: 0, cacheWrite: 0 }] }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } }, "gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tiers: [{ inputTokensAbove: 272e3, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsExplicitPromptCacheMode: true } }, "gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [{ inputTokensAbove: 272e3, input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsExplicitPromptCacheMode: true } }, "gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272e3, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsExplicitPromptCacheMode: true } }, "gpt-6-astra": { id: "gpt-6-astra", name: "GPT-6 Astra", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, tiers: [{ inputTokensAbove: 272e3, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }] }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true, supportsExplicitPromptCacheMode: true } }, "gpt-realtime-2.1": { id: "gpt-realtime-2.1", name: "GPT-Realtime-2.1", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 4, output: 24, cacheRead: 0.4, cacheWrite: 0 }, contextWindow: 128e3, maxTokens: 32e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }, compat: { supportsStrictMode: true } }, o1: { id: "o1", name: "o1", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true } }, "o1-pro": { id: "o1-pro", name: "o1-pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 150, output: 600, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true } }, o3: { id: "o3", name: "o3", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true } }, "o3-mini": { id: "o3-mini", name: "o3-mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text"], cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true } }, "o3-pro": { id: "o3-pro", name: "o3-pro", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 20, output: 80, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true } }, "o4-mini": { id: "o4-mini", name: "o4-mini", api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 }, contextWindow: 2e5, maxTokens: 1e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null }, compat: { supportsStrictMode: true } } } };

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/openai.models.js
var OPENAI_MODELS = flattenModelCatalog("openai", openai_default);

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/data/opencode.json
var opencode_default = { "anthropic-messages": { "claude-fable-5": { id: "claude-fable-5", name: "Claude Fable 5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true } }, "claude-fable-5-1": { id: "claude-fable-5-1", name: "Claude Fable 5.1", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true } }, "claude-haiku-4-5": { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, contextWindow: 2e5, maxTokens: 64e3 }, "claude-opus-4-5": { id: "claude-opus-4-5", name: "Claude Opus 4.5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 2e5, maxTokens: 64e3 }, "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { max: "max" }, compat: { forceAdaptiveThinking: true } }, "claude-opus-4-7": { id: "claude-opus-4-7", name: "Claude Opus 4.7", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false } }, "claude-opus-4-8": { id: "claude-opus-4-8", name: "Claude Opus 4.8", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false } }, "claude-opus-5": { id: "claude-opus-5", name: "Claude Opus 5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false } }, "claude-sonnet-4": { id: "claude-sonnet-4", name: "Claude Sonnet 4", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 2e5, maxTokens: 64e3 }, "claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 2e5, maxTokens: 64e3 }, "claude-sonnet-4-6": { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 1e6, maxTokens: 64e3, thinkingLevelMap: { max: "max" }, compat: { forceAdaptiveThinking: true } }, "claude-sonnet-5": { id: "claude-sonnet-5", name: "Claude Sonnet 5", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, contextWindow: 1e6, maxTokens: 128e3, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true } }, "qwen3.5-plus": { id: "qwen3.5-plus", name: "Qwen3.5 Plus", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 }, contextWindow: 262144, maxTokens: 65536 }, "qwen3.6-plus": { id: "qwen3.6-plus", name: "Qwen3.6 Plus", api: "anthropic-messages", provider: "opencode", baseUrl: "https://opencode.ai/zen", reasoning: true, input: ["text", "image"], cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.625 }, contextWindow: 262144, maxTokens: 65536 } }, "google-generative-ai": { "gemini-3-flash": { id: "gemini-3-flash", name: "Gemini 3 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null } }, "gemini-3.1-pro": { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro Preview", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null, minimal: null, low: "LOW", medium: null, high: "HIGH" } }, "gemini-3.5-flash": { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null } }, "gemini-3.5-flash-lite": { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null } }, "gemini-3.6-flash": { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null } }, "gemini-3.7-flash": { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null } }, "gemini-3.8-flash": { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", api: "google-generative-ai", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 65536, thinkingLevelMap: { off: null } } }, "openai-completions": { "big-pickle": { id: "big-pickle", name: "Big Pickle", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 2e5, maxTokens: 32e3 }, "deepseek-v4-flash": { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, requiresReasoningContentOnAssistantMessages: true }, contextWindow: 1e6, maxTokens: 384e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" } }, "deepseek-v4-flash-vision-exp": { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", requiresReasoningContentOnAssistantMessages: true }, contextWindow: 1e6, maxTokens: 384e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" } }, "deepseek-v4-pro": { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 1.74, output: 3.84, cacheRead: 0.145, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false, requiresReasoningContentOnAssistantMessages: true }, contextWindow: 1e6, maxTokens: 384e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" } }, "glm-5": { id: "glm-5", name: "GLM-5", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 204800, maxTokens: 131072 }, "glm-5.1": { id: "glm-5.1", name: "GLM-5.1", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 204800, maxTokens: 131072 }, "glm-5.2": { id: "glm-5.2", name: "GLM-5.2", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" } }, "glm-5.3": { id: "glm-5.3", name: "GLM-5.3", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" } }, "glm-5.3-flash": { id: "glm-5.3-flash", name: "GLM-5.3-Flash", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" } }, "kimi-k2.5": { id: "kimi-k2.5", name: "Kimi K2.5", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.6, output: 3, cacheRead: 0.08, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false }, contextWindow: 262144, maxTokens: 65536 }, "kimi-k2.6": { id: "kimi-k2.6", name: "Kimi K2.6", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, thinkingFormat: "deepseek", supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false }, contextWindow: 262144, maxTokens: 65536 }, "kimi-k2.7-code": { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 262144, maxTokens: 262144 }, "kimi-k3": { id: "kimi-k3", name: "Kimi K3", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1048576, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: "max" } }, "ling-3.0-flash-fin-free": { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 262144, maxTokens: 32768 }, "mimo-v2.5-free": { id: "mimo-v2.5-free", name: "MiMo V2.5 Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 2e5, maxTokens: 32e3 }, "minimax-m2.5": { id: "minimax-m2.5", name: "MiniMax-M2.5", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 204800, maxTokens: 131072 }, "minimax-m2.7": { id: "minimax-m2.7", name: "MiniMax-M2.7", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false }, contextWindow: 204800, maxTokens: 131072 }, "minimax-m3": { id: "minimax-m3", name: "MiniMax-M3", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 512e3, maxTokens: 128e3 }, "nemotron-3-ultra-free": { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 128e3 }, "nemotron-3.5-lightning-free": { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", api: "openai-completions", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 262144, maxTokens: 262144 } }, "openai-responses": { "gpt-5": { id: "gpt-5", name: "GPT-5", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "gpt-5-codex": { id: "gpt-5-codex", name: "GPT-5 Codex", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.05, output: 0.4, cacheRead: 5e-3, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "gpt-5.1": { id: "gpt-5.1", name: "GPT-5.1", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "gpt-5.1-codex": { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "gpt-5.1-codex-max": { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.1-codex-mini": { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.2-codex": { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 272e3, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.4-nano": { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 4e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.4-pro": { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 30, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.5-pro": { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 30, output: 180, cacheRead: 30, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } }, "gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol (50% Off)", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } }, "gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } }, "gpt-6-astra": { id: "gpt-6-astra", name: "GPT-6 Astra", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, compat: { sessionAffinityFormat: "openai-nosession", supportsOpenAIGrammarTools: true }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } }, "grok-4.5": { id: "grok-4.5", name: "Grok 4.5", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 5e5, maxTokens: 5e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "grok-4.6": { id: "grok-4.6", name: "Grok 4.6", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 5e5, maxTokens: 5e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "grok-build-0.1": { id: "grok-build-0.1", name: "Grok Build 0.1", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession", supportsReasoningEffort: false }, contextWindow: 256e3, maxTokens: 256e3, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null } }, "muse-spark-1.2": { id: "muse-spark-1.2", name: "Muse Spark 1.2", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 1048576, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "muse-spark-1.2-contributor-free": { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Free", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 1048576, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "muse-spark-1.3": { id: "muse-spark-1.3", name: "Muse Spark 1.3", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 1048576, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } }, "muse-spark-1.3-contributor-free": { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Free", api: "openai-responses", provider: "opencode", baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 1048576, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } } } };

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/opencode.models.js
var OPENCODE_MODELS = flattenModelCatalog("opencode", opencode_default);

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json
var opencode_go_default = { "anthropic-messages": { "minimax-m3": { id: "minimax-m3", name: "MiniMax-M3", api: "anthropic-messages", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go", reasoning: true, input: ["text", "image"], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 131072 }, "qwen3.8-flash": { id: "qwen3.8-flash", name: "Qwen3.8 Flash", api: "anthropic-messages", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go", reasoning: true, input: ["text", "image"], cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 }, contextWindow: 1e6, maxTokens: 131072 } }, "openai-completions": { "deepseek-v4-flash": { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 0.22, output: 0.66, cacheRead: 7e-3, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, contextWindow: 1e6, maxTokens: 384e3, thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" } }, "deepseek-v4-flash-vision-exp": { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.22, output: 0.66, cacheRead: 7e-3, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, contextWindow: 1e6, maxTokens: 384e3, thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" } }, "deepseek-v4-pro": { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (New)", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }, contextWindow: 1e6, maxTokens: 384e3, thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" } }, "glm-5.1": { id: "glm-5.1", name: "GLM-5.1", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 202752, maxTokens: 32768 }, "glm-5.2": { id: "glm-5.2", name: "GLM-5.2", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" } }, "glm-5.3": { id: "glm-5.3", name: "GLM-5.3", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" } }, "glm-5.3-flash": { id: "glm-5.3-flash", name: "GLM-5.3-Flash (2x usage)", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.075, output: 0.25, cacheRead: 0.015, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" } }, hy3: { id: "hy3", name: "Hy3", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 256e3, maxTokens: 128e3, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: null } }, "hy4-preview": { id: "hy4-preview", name: "Hy4 preview", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1024e3, maxTokens: 64e3, thinkingLevelMap: { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null } }, "kimi-k2.6": { id: "kimi-k2.6", name: "Kimi K2.6", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, thinkingFormat: "deepseek", supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false }, contextWindow: 262144, maxTokens: 65536, thinkingLevelMap: { minimal: null, low: null, medium: null } }, "kimi-k2.7-code": { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 262144, maxTokens: 262144 }, "kimi-k3": { id: "kimi-k3", name: "Kimi K3", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1048576, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: "max" } }, "longcat-2.0": { id: "longcat-2.0", name: "LongCat-2.0", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 0.3, output: 1.2, cacheRead: 6e-3, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 131072 }, "mimo-v2.5": { id: "mimo-v2.5", name: "MiMo V2.5", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.14, output: 0.28, cacheRead: 28e-4, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 128e3 }, "mimo-v2.5-pro": { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 0.435, output: 0.87, cacheRead: 3625e-6, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1048576, maxTokens: 128e3 }, "minimax-m2.7": { id: "minimax-m2.7", name: "MiniMax-M2.7", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 204800, maxTokens: 131072 }, "omen-alpha": { id: "omen-alpha", name: "Omen Alpha", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 0.66, cacheRead: 0.04, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 5e5, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: null } }, "qwen3.6-plus": { id: "qwen3.6-plus", name: "Qwen3.6 Plus", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.625 }, compat: { supportsStore: false, supportsDeveloperRole: false, thinkingFormat: "qwen", maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 65536 }, "qwen3.7-max": { id: "qwen3.7-max", name: "Qwen3.7 Max", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text"], cost: { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.125 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 65536 }, "qwen3.7-plus": { id: "qwen3.7-plus", name: "Qwen3.7 Plus", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 65536 }, "qwen3.8-max": { id: "qwen3.8-max", name: "Qwen3.8 Max", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }, contextWindow: 1e6, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh", max: null } } }, "openai-responses": { "gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", api: "openai-responses", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 105e4, maxTokens: 128e3, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } }, "grok-4.6": { id: "grok-4.6", name: "Grok 4.6", api: "openai-responses", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 5e5, maxTokens: 5e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "muse-spark-1.2-contributor": { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", api: "openai-responses", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.2, cacheRead: 2e-3, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 1048576, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } }, "muse-spark-1.3-contributor": { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", api: "openai-responses", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", reasoning: true, input: ["text", "image"], cost: { input: 0.1, output: 0.2, cacheRead: 2e-3, cacheWrite: 0 }, compat: { sessionAffinityFormat: "openai-nosession" }, contextWindow: 1048576, maxTokens: 131072, thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } } } };

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/opencode-go.models.js
var OPENCODE_GO_MODELS = flattenModelCatalog("opencode-go", opencode_go_default);

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/data/xai.json
var xai_default = { "openai-responses": { "grok-4.3": { id: "grok-4.3", name: "Grok 4.3", api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1", compat: { supportsLongCacheRetention: false }, reasoning: true, input: ["text", "image"], cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 }, contextWindow: 1e6, maxTokens: 3e4, thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "grok-4.5": { id: "grok-4.5", name: "Grok 4.5", api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1", compat: { supportsLongCacheRetention: false }, reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 }, contextWindow: 5e5, maxTokens: 5e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null } }, "grok-4.6": { id: "grok-4.6", name: "Grok 4.6", api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1", compat: { supportsLongCacheRetention: false }, reasoning: true, input: ["text", "image"], cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 5e5, maxTokens: 5e5, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } } } };

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/providers/xai.models.js
var XAI_MODELS = flattenModelCatalog("xai", xai_default);

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js
var EventStream = class {
  queue = [];
  waiting = [];
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
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }
  end(result) {
    this.done = true;
    if (result !== void 0) {
      this.resolveFinalResult(result);
    }
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift();
      waiter({ value: void 0, done: true });
    }
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift();
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise((resolve) => this.waiting.push(resolve));
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
};
function createAssistantMessageEventStream() {
  return new AssistantMessageEventStream();
}

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/models.js
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

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/utils/hash.js
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

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/utils/json-parse.js
var import_partial_json = __toESM(require_dist(), 1);
var VALID_JSON_ESCAPES = /* @__PURE__ */ new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);
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
function parseStreamingJson(partialJson) {
  if (!partialJson || partialJson.trim() === "") {
    return {};
  }
  try {
    return parseJsonWithRepair(partialJson);
  } catch {
    try {
      const result = (0, import_partial_json.parse)(partialJson);
      return result ?? {};
    } catch {
      try {
        const result = (0, import_partial_json.parse)(repairJson(partialJson));
        return result ?? {};
      } catch {
        return {};
      }
    }
  }
}

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/utils/sanitize-unicode.js
function sanitizeSurrogates(text) {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.js
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
function makeJsonSchemaNodeStrict(schema) {
  if (!isJsonSchemaObject(schema)) {
    throw new UnsupportedStrictJsonSchemaError("boolean schemas are unsupported");
  }
  for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) {
    if (schema[key] !== void 0) {
      throw new UnsupportedStrictJsonSchemaError(`${key} schemas are unsupported`);
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
      makeJsonSchemaNodeStrict(variant);
    }
  }
  if (schema.items !== void 0) {
    if (Array.isArray(schema.items)) {
      throw new UnsupportedStrictJsonSchemaError("tuple schemas are unsupported");
    }
    makeJsonSchemaNodeStrict(schema.items);
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
    makeJsonSchemaNodeStrict(property);
    if (!required.has(key) && !schemaAllowsNull(property)) {
      properties[key] = { anyOf: [property, { type: "null" }] };
    }
  }
  schema.required = propertyNames;
  schema.additionalProperties = false;
}
function makeStrictJsonSchema(schema) {
  const cloned = structuredClone(schema);
  if (!isJsonSchemaObject(cloned)) {
    throw new UnsupportedStrictJsonSchemaError("root schema must have type object");
  }
  makeJsonSchemaNodeStrict(cloned);
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
function appendGrammarToolInputJsonDelta(buffer, inputProperty, nextInput, close) {
  if (buffer.closed) {
    if (close && nextInput === buffer.input)
      return void 0;
    throw new Error(`grammar tool input for property "${inputProperty}" changed after it was closed`);
  }
  if (!nextInput.startsWith(buffer.input)) {
    throw new Error(`grammar tool input for property "${inputProperty}" changed non-monotonically`);
  }
  const inputDelta = nextInput.slice(buffer.input.length);
  if (!close && inputDelta.length === 0)
    return void 0;
  let delta = "";
  if (!buffer.started) {
    delta += `{${JSON.stringify(inputProperty)}:"`;
    buffer.started = true;
  }
  delta += JSON.stringify(inputDelta).slice(1, -1);
  buffer.input = nextInput;
  if (close) {
    delta += '"}';
    buffer.closed = true;
  }
  return delta;
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
function resolveJsonSchemaStrictSampling(tool, supportsStrictMode) {
  const config = tool.constrainedSampling;
  if (!config || config.type !== "json_schema")
    return void 0;
  if (supportsStrictMode) {
    try {
      makeStrictJsonSchema(tool.parameters);
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

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js
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
    if (msg.role === "user") {
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
          if (block.redacted) {
            return isSameModel ? block : [];
          }
          if (isSameModel && block.thinkingSignature)
            return block;
          if (!block.thinking || block.thinking.trim() === "")
            return [];
          if (isSameModel)
            return block;
          return {
            type: "text",
            text: block.thinking
          };
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
  const insertSyntheticToolResults = () => {
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
  };
  for (let i = 0; i < transformed.length; i++) {
    const msg = transformed[i];
    if (msg.role === "assistant") {
      insertSyntheticToolResults();
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
    } else if (msg.role === "user") {
      insertSyntheticToolResults();
      result.push(msg);
    } else {
      result.push(msg);
    }
  }
  insertSyntheticToolResults();
  return result;
}

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js
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
  const hasText = textResult.length > 0;
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
function convertResponsesMessages(model, context, allowedToolCallProviders, options) {
  const messages = [];
  const loadedToolNames = /* @__PURE__ */ new Set();
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
  const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);
  const includeSystemPrompt = options?.includeSystemPrompt ?? true;
  if (includeSystemPrompt && context.systemPrompt) {
    const compat = model.compat;
    const role = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";
    messages.push({
      role,
      content: sanitizeSurrogates(context.systemPrompt)
    });
  }
  let msgIndex = 0;
  for (const msg of transformedMessages) {
    if (msg.role === "user") {
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
          if (isDifferentModel && itemId?.startsWith("fc_") || customInputProperty === void 0 && !itemId?.startsWith("fc_")) {
            itemId = void 0;
          }
          const canReplayNamespace = isSameModel || options?.deferredTools?.has(toolCall.name) === true;
          if (customInputProperty !== void 0) {
            output.push({
              type: "custom_tool_call",
              id: itemId,
              call_id: callId,
              name: toolCall.name,
              input: sanitizeSurrogates(getGrammarToolInput(toolCall.name, toolCall.arguments, customInputProperty)),
              ...canReplayNamespace && toolCall.namespace !== void 0 ? { namespace: toolCall.namespace } : {}
            });
          } else {
            output.push({
              type: "function_call",
              id: itemId,
              call_id: callId,
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
              ...canReplayNamespace && toolCall.namespace !== void 0 ? { namespace: toolCall.namespace } : {}
            });
          }
        }
      }
      if (output.length === 0)
        continue;
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
      const deferredTools = [];
      for (const name of msg.addedToolNames ?? []) {
        const tool = options?.deferredTools?.get(name);
        if (!tool || loadedToolNames.has(name))
          continue;
        loadedToolNames.add(name);
        deferredTools.push(tool);
      }
      if (deferredTools.length > 0 && options?.deferredToolsMode === "additional-tools") {
        messages.push({
          type: "additional_tools",
          role: "developer",
          tools: convertResponsesTools(deferredTools, options.toolOptions)
        });
      } else if (deferredTools.length > 0 && options?.deferredToolsMode === "tool-search") {
        const names = deferredTools.map((tool) => tool.name);
        const searchCallId = `pi_tool_load_${shortHash(`${msg.toolCallId}:${names.join(",")}`)}`;
        messages.push({
          type: "tool_search_call",
          call_id: searchCallId,
          execution: "client",
          status: "completed",
          arguments: { query: names.join(" "), limit: names.length }
        });
        messages.push({
          type: "tool_search_output",
          call_id: searchCallId,
          execution: "client",
          status: "completed",
          tools: convertResponsesTools(deferredTools, {
            ...options.toolOptions,
            deferLoading: true
          })
        });
      }
    }
    msgIndex++;
  }
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
        ...options?.deferLoading ? { defer_loading: true } : {}
      };
    }
    const constrainedStrict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
    const strict = constrainedStrict ?? defaultStrict;
    const functionTool = {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: getJsonSchemaToolParameters(tool, strict === true),
      ...options?.deferLoading ? { defer_loading: true } : {}
    };
    if (supportsStrictMode) {
      functionTool.strict = strict;
    }
    return functionTool;
  });
}
function getCustomToolCallInput(block) {
  const property = block.customInput?.property;
  if (property === void 0)
    return "";
  const value = block.arguments[property];
  return typeof value === "string" ? value : "";
}
function appendCustomToolCallInput(block, nextInput, close) {
  const customInput = block.customInput;
  if (!customInput)
    return void 0;
  const delta = appendGrammarToolInputJsonDelta(customInput.jsonBuffer, customInput.property, nextInput, close);
  block.arguments = { [customInput.property]: nextInput };
  return delta;
}
async function processResponsesStream(openaiStream, output, stream, model, options) {
  let sawTerminalResponseEvent = false;
  const outputSlots = /* @__PURE__ */ new Map();
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
      const block = {
        type: "toolCall",
        id: `${item.call_id}|${item.id}`,
        name: item.name,
        arguments: {},
        ...item.namespace !== void 0 ? { namespace: item.namespace } : {},
        partialJson: item.arguments || ""
      };
      output.content.push(block);
      const slot = {
        type: "toolCall",
        block,
        contentIndex: output.content.length - 1
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
        ...item.namespace !== void 0 ? { namespace: item.namespace } : {},
        customInput: {
          property: inputProperty,
          jsonBuffer: { input: "", started: false, closed: false }
        }
      };
      output.content.push(block);
      const slot = {
        type: "toolCall",
        block,
        contentIndex: output.content.length - 1
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
      if (!slot || slot.block.partialJson === void 0)
        continue;
      slot.block.partialJson += event.delta;
      slot.block.arguments = parseStreamingJson(slot.block.partialJson);
      pushToolCallDelta(slot, event.delta);
    } else if (event.type === "response.function_call_arguments.done") {
      const slot = getSlot(event.output_index, "toolCall");
      if (!slot || slot.block.partialJson === void 0)
        continue;
      const previousPartialJson = slot.block.partialJson;
      slot.block.partialJson = event.arguments;
      slot.block.arguments = parseStreamingJson(slot.block.partialJson);
      if (event.arguments.startsWith(previousPartialJson)) {
        const delta = event.arguments.slice(previousPartialJson.length);
        if (delta.length > 0)
          pushToolCallDelta(slot, delta);
      }
    } else if (event.type === "response.custom_tool_call_input.delta") {
      const slot = getSlot(event.output_index, "toolCall");
      if (!slot || !slot.block.customInput)
        continue;
      pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, getCustomToolCallInput(slot.block) + event.delta, false));
    } else if (event.type === "response.custom_tool_call_input.done") {
      const slot = getSlot(event.output_index, "toolCall");
      if (!slot || !slot.block.customInput)
        continue;
      pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, event.input, true));
    } else if (event.type === "response.output_item.done") {
      const item = event.item;
      applyMessagePhaseStopReason(item);
      const slot = getOrCreateSlot(event.output_index, item);
      if (item.type === "reasoning" && slot?.type === "thinking") {
        const summaryText = item.summary?.map((s) => s.text).join("\n\n") || "";
        const contentText = item.content?.map((c) => c.text).join("\n\n") || "";
        slot.block.thinking = summaryText || contentText || slot.block.thinking;
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
      } else if (item.type === "function_call" && slot?.type === "toolCall" && slot.block.partialJson !== void 0) {
        slot.block.arguments = parseStreamingJson(item.arguments || slot.block.partialJson || "{}");
        if (item.namespace !== void 0)
          slot.block.namespace = item.namespace;
        delete slot.block.partialJson;
        stream.push({
          type: "toolcall_end",
          contentIndex: slot.contentIndex,
          toolCall: slot.block,
          partial: output
        });
        outputSlots.delete(event.output_index);
      } else if (item.type === "custom_tool_call" && slot?.type === "toolCall" && slot.block.customInput) {
        pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, item.input ?? getCustomToolCallInput(slot.block), true));
        if (item.namespace !== void 0)
          slot.block.namespace = item.namespace;
        delete slot.block.customInput;
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

// scripts/runtime-dsh015/node_modules/@earendil-works/pi-ai/dist/api/openai-prompt-cache.js
var OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;
function clampOpenAIPromptCacheKey(key) {
  if (key === void 0)
    return void 0;
  const chars = Array.from(key);
  if (chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH)
    return key;
  return chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("");
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
var providers = Object.freeze(
  Object.keys(RESPONSE_CATALOGS)
);
function responsesOnly(catalog) {
  return Object.values(catalog).filter(
    (model) => model.api === "openai-responses"
  );
}
var models = {
  "cloudflare-ai-gateway": responsesOnly(RESPONSE_CATALOGS["cloudflare-ai-gateway"]),
  "github-copilot": responsesOnly(RESPONSE_CATALOGS["github-copilot"]),
  openai: responsesOnly(RESPONSE_CATALOGS.openai),
  opencode: responsesOnly(RESPONSE_CATALOGS.opencode),
  "opencode-go": responsesOnly(RESPONSE_CATALOGS["opencode-go"]),
  xai: responsesOnly(RESPONSE_CATALOGS.xai)
};
function getBuiltinProviders() {
  return providers;
}
function getBuiltinModels(provider) {
  return models[provider] ?? [];
}
export {
  clampOpenAIPromptCacheKey,
  convertResponsesMessages,
  convertResponsesTools,
  createAssistantMessageEventStream,
  createGrammarToolInputProperties,
  getBuiltinModels,
  getBuiltinProviders,
  getSupportedThinkingLevels,
  processResponsesStream
};
