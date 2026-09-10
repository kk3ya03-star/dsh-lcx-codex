import { symbols as cordisSymbols } from "@deepseek-ai/cordis";
import {
  Session,
  SessionId,
  type SessionStore,
} from "@deepseek-ai/dsh-session";
import type { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { InvocationPolicyScope } from "./invocation-policy-scope.js";
import { ServiceMutex } from "./service-mutex.js";

type CompatMethod = (
  this: object,
  agent: unknown,
  trigger: string,
  signal: AbortSignal,
) => Promise<unknown>;
type PrunerMethod = (...args: unknown[]) => unknown;
type MutableService = Record<PropertyKey, unknown>;

interface AgentLike {
  ctx?: unknown;
  options?: unknown;
  session?: unknown;
}

type AgentSessionLike = {
  id?: unknown;
  requestHeader?: () => { config?: unknown };
};

interface CompactionService extends MutableService {
  compactIfNeeded: CompatMethod;
}

export interface CompactionPatchRecord {
  compaction: CompactionService;
  original: CompatMethod;
  originalOwnDescriptor: PropertyDescriptor | undefined;
  installedOwnDescriptor: PropertyDescriptor;
  wrapper: CompatMethod;
  mutex: ServiceMutex;
  policyScope: InvocationPolicyScope;
  lifecycle: AbortController;
}

export type CompactionPatchRecords = Map<object, CompactionPatchRecord>;

export type CompactionPatchBehavior = (
  agent: unknown,
  trigger: string,
  signal: AbortSignal,
  callOriginal: (signal: AbortSignal) => Promise<unknown>,
) => Promise<unknown>;

interface PrunerService extends MutableService {
  pruneSession: unknown;
}

export interface PrunerPatchRecord {
  pruner: PrunerService;
  original: unknown;
  replacement: PrunerMethod;
}

interface ConfigService extends MutableService {
  config: unknown;
}

export interface ConfigPatchRecord {
  service: ConfigService;
  original: unknown;
  installed: unknown;
}

function mutableService(value: unknown): value is MutableService {
  return (
    value !== null && (typeof value === "object" || typeof value === "function")
  );
}

function agentLike(value: unknown): AgentLike | undefined {
  return mutableService(value) ? (value as AgentLike) : undefined;
}

function agentSession(value: unknown): AgentSessionLike | undefined {
  return mutableService(value) ? (value as AgentSessionLike) : undefined;
}

export function agentSessionId(agent: unknown): string {
  return String(agentSession(agentLike(agent)?.session)?.id ?? "");
}

export function agentUsesSession(agent: unknown, session: Session): boolean {
  return agentLike(agent)?.session === session;
}

export function sessionFromAgent(agent: unknown): Session | undefined {
  const session = agentLike(agent)?.session;
  return session instanceof Session ? session : undefined;
}

export function readAgentRouteState(agent: unknown): {
  requestConfig: unknown;
  options: unknown;
  sessionId: string;
} {
  const value = agentLike(agent);
  return {
    requestConfig: agentSession(value?.session)?.requestHeader?.()?.config,
    options: value?.options,
    sessionId: agentSessionId(value),
  };
}

export function scopedToolRuntime(
  agent: unknown,
): (Pick<ToolRuntime, "register"> & Partial<Pick<ToolRuntime, "get">>) | undefined {
  const tools = resolveScopedService(agent, "tools");
  if (!mutableService(tools) || typeof tools.register !== "function") return undefined;
  return {
    register: (tools.register as ToolRuntime["register"]).bind(tools),
    ...(typeof tools.get === "function"
      ? { get: (tools.get as ToolRuntime["get"]).bind(tools) }
      : {}),
  };
}

export function tokenMeterTotal(value: unknown, session: Session): number | undefined {
  if (!mutableService(value) || typeof value.measure !== "function") return undefined;
  const measurement = Reflect.apply(value.measure, value, [session]);
  if (!mutableService(measurement) || typeof measurement.totalTokens !== "number")
    return undefined;
  return Number.isFinite(measurement.totalTokens) ? measurement.totalTokens : undefined;
}

export function sessionsService(
  ctx: unknown,
): Pick<SessionStore, "get"> | undefined {
  const service = resolveContextService(ctx, "sessions");
  if (!mutableService(service) || typeof service.get !== "function")
    return undefined;
  return {
    get(id) {
      const value = Reflect.apply(service.get as CompatMethod, service, [id]);
      return value instanceof Session ? value : undefined;
    },
  };
}
export function sessionFor(
  ctx: unknown,
  sessionId: string,
): Session | undefined {
  return sessionId
    ? sessionsService(ctx)?.get(SessionId(sessionId))
    : undefined;
}

export function readWebSearchProvider(ctx: unknown): unknown {
  const web = resolveContextService(ctx, "web");
  if (!mutableService(web)) return undefined;
  try {
    return Reflect.get(web, "searchProviderId");
  } catch {
    return undefined;
  }
}

export function writeWebSearchProvider(
  ctx: unknown,
  providerId: unknown,
): boolean {
  const web = resolveContextService(ctx, "web");
  if (!mutableService(web)) return false;
  try {
    if (!Reflect.set(web, "searchProviderId", providerId)) return false;
    return Reflect.get(web, "searchProviderId") === providerId;
  } catch {
    return false;
  }
}

export function contextService(ctx: unknown, name: string): unknown {
  if (!mutableService(ctx)) return undefined;
  const get = ctx.get;
  return (
    (typeof get === "function" ? Reflect.apply(get, ctx, [name]) : undefined) ??
    ctx[name]
  );
}

export function resolveContextService(ctx: unknown, name: string): unknown {
  try {
    return contextService(ctx, name);
  } catch {
    return undefined;
  }
}

export function resolveScopedService(agent: unknown, name: string): unknown {
  return resolveContextService(agentLike(agent)?.ctx, name);
}

export function resolveAgentService(
  ctx: unknown,
  agent: unknown,
  name: string,
): unknown {
  const agentPresets = resolveContextService(ctx, "agentPresets");
  if (
    !mutableService(agentPresets) ||
    typeof agentPresets.serviceFor !== "function"
  )
    return undefined;
  try {
    return Reflect.apply(agentPresets.serviceFor, agentPresets, [agent, name]);
  } catch {
    return undefined;
  }
}

export function concreteService(value: unknown): unknown {
  if (!mutableService(value)) return value;
  try {
    return value[cordisSymbols.original] ?? value;
  } catch {
    return value;
  }
}

export function compactionPatchCandidate(
  value: unknown,
  records: ReadonlyMap<object, CompactionPatchRecord>,
): Pick<
  CompactionPatchRecord,
  "compaction" | "original" | "originalOwnDescriptor"
> | undefined {
  const compaction = concreteService(value);
  if (
    !mutableService(compaction) ||
    typeof compaction.compactIfNeeded !== "function" ||
    records.has(compaction)
  )
    return undefined;
  let originalOwnDescriptor: PropertyDescriptor | undefined;
  try {
    originalOwnDescriptor = Object.getOwnPropertyDescriptor(
      compaction,
      "compactIfNeeded",
    );
  } catch {
    return undefined;
  }
  return {
    compaction: compaction as CompactionService,
    original: compaction.compactIfNeeded as CompatMethod,
    originalOwnDescriptor,
  };
}

function inheritedPropertyDescriptor(
  target: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  try {
    for (
      let current = Object.getPrototypeOf(target);
      current;
      current = Object.getPrototypeOf(current)
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return descriptor;
    }
  } catch {}
  return undefined;
}

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor,
): boolean {
  return (
    left !== undefined &&
    "value" in left &&
    "value" in right &&
    left.value === right.value &&
    left.writable === right.writable &&
    left.enumerable === right.enumerable &&
    left.configurable === right.configurable
  );
}

export function installCompactionPatch(
  records: CompactionPatchRecords,
  candidate: Pick<
    CompactionPatchRecord,
    "compaction" | "original" | "originalOwnDescriptor"
  >,
  mutex: ServiceMutex,
  policyScope: InvocationPolicyScope,
  lifecycle: AbortController,
  behavior: CompactionPatchBehavior,
): boolean {
  const { compaction, original, originalOwnDescriptor } = candidate;
  if (
    originalOwnDescriptor &&
    (!("value" in originalOwnDescriptor) || originalOwnDescriptor.writable !== true)
  )
    return false;
  if (!originalOwnDescriptor) {
    const inherited = inheritedPropertyDescriptor(
      compaction,
      "compactIfNeeded",
    );
    if (!inherited || !("value" in inherited) || inherited.writable !== true)
      return false;
  }
  const callOriginal = async (agent: unknown, trigger: string, signal: AbortSignal) => {
    const result = Reflect.apply(original, compaction, [agent, trigger, signal]);
    return Promise.resolve(result);
  };
  const wrapper: CompatMethod = async function (agent, trigger, signal) {
    return behavior(agent, trigger, signal, (activeSignal) =>
      callOriginal(agent, trigger, activeSignal),
    );
  };
  const installedOwnDescriptor: PropertyDescriptor = originalOwnDescriptor
    ? { ...originalOwnDescriptor, value: wrapper }
    : {
        configurable: true,
        enumerable: true,
        writable: true,
        value: wrapper,
      };
  try {
    Object.defineProperty(
      compaction,
      "compactIfNeeded",
      installedOwnDescriptor,
    );
  } catch {
    return false;
  }
  if (
    !sameDataDescriptor(
      Object.getOwnPropertyDescriptor(compaction, "compactIfNeeded"),
      installedOwnDescriptor,
    )
  ) {
    try {
      if (originalOwnDescriptor)
        Object.defineProperty(
          compaction,
          "compactIfNeeded",
          originalOwnDescriptor,
        );
      else Reflect.deleteProperty(compaction, "compactIfNeeded");
    } catch {}
    return false;
  }
  records.set(compaction, {
    compaction,
    original,
    originalOwnDescriptor,
    installedOwnDescriptor,
    wrapper,
    mutex,
    policyScope,
    lifecycle,
  });
  return true;
}

export function restoreCompactionPatches(
  records: Map<object, CompactionPatchRecord>,
  entries: Iterable<CompactionPatchRecord> = records.values(),
): void {
  for (const record of entries) {
    const current = Object.getOwnPropertyDescriptor(
      record.compaction,
      "compactIfNeeded",
    );
    if (!sameDataDescriptor(current, record.installedOwnDescriptor)) continue;
    try {
      if (record.originalOwnDescriptor)
        Object.defineProperty(
          record.compaction,
          "compactIfNeeded",
          record.originalOwnDescriptor,
        );
      else Reflect.deleteProperty(record.compaction, "compactIfNeeded");
    } catch {}
  }
  records.clear();
}

export function toolResultPrunerState(value: unknown): {
  pruner: PrunerService | undefined;
  original: unknown;
} {
  const pruner = concreteService(value);
  return mutableService(pruner)
    ? { pruner: pruner as PrunerService, original: pruner.pruneSession }
    : { pruner: undefined, original: undefined };
}

export function patchToolResultPruner(
  state: { pruner: PrunerService | undefined; original: unknown },
  replacement: PrunerMethod,
): PrunerPatchRecord | undefined {
  if (!state.pruner || typeof state.original !== "function") return undefined;
  state.pruner.pruneSession = replacement;
  return { pruner: state.pruner, original: state.original, replacement };
}

export function restoreToolResultPruner(
  record: PrunerPatchRecord | undefined,
): void {
  if (record && record.pruner.pruneSession === record.replacement) {
    try {
      record.pruner.pruneSession = record.original;
    } catch {}
  }
}

export function compactionConfigState(service: unknown): {
  service: ConfigService | undefined;
  original: unknown;
} {
  return mutableService(service)
    ? { service: service as ConfigService, original: service.config }
    : { service: undefined, original: undefined };
}

export function patchCompactionConfig(
  state: { service: ConfigService | undefined; original: unknown },
  createConfig: (originalConfig: unknown) => unknown,
): ConfigPatchRecord | undefined {
  if (
    !state.original ||
    !state.service ||
    !Object.prototype.hasOwnProperty.call(state.service, "config")
  )
    return undefined;
  try {
    const installed = createConfig(state.original);
    state.service.config = installed;
    return { service: state.service, original: state.original, installed };
  } catch {
    return undefined;
  }
}

export function restoreCompactionConfig(
  record: ConfigPatchRecord | undefined,
): void {
  if (record && record.service.config === record.installed) {
    try {
      record.service.config = record.original;
    } catch {}
  }
}

export function patchVisibleWebSearchTimeout(
  agent: unknown,
  getTimeoutMs: () => number | undefined,
  patchedDefinitions: Map<MutableService, unknown>,
): void {
  const tools = resolveScopedService(agent, "tools");
  if (!mutableService(tools) || typeof tools.get !== "function") return;
  const definition = Reflect.apply(tools.get, tools, ["web_search", agent]);
  if (!mutableService(definition)) return;
  if (!patchedDefinitions.has(definition))
    patchedDefinitions.set(definition, definition.timeoutMs);
  const timeoutMs = getTimeoutMs();
  const target =
    timeoutMs === undefined ? patchedDefinitions.get(definition) : timeoutMs;
  try {
    definition.timeoutMs = target;
  } catch {}
}

export function refreshVisibleWebSearchTimeouts(
  patchedDefinitions: ReadonlyMap<MutableService, unknown>,
  timeoutMs: number | undefined,
): void {
  for (const [definition, original] of patchedDefinitions) {
    try {
      definition.timeoutMs = timeoutMs === undefined ? original : timeoutMs;
    } catch {}
  }
}

export function restoreVisibleWebSearchTimeouts(
  patchedDefinitions: Map<MutableService, unknown>,
): void {
  for (const [definition, original] of patchedDefinitions) {
    try {
      if (original === undefined) delete definition.timeoutMs;
      else definition.timeoutMs = original;
    } catch {}
  }
  patchedDefinitions.clear();
}
