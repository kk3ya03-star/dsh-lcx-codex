/**
 * Nested (programmatic tool calling) settlements on the Client.
 *
 * DSH 0.2.1 records a tool a `run_code` program called as `tool/ptc-dispatch`, not as `tool/result`, and that
 * event names only the root `run_code` call: it carries no `turn`. A Conversation Definition's `match()` must
 * return its Context identity from the current event alone, and LCX's Contexts are keyed by turn, so the turn
 * of a root call is remembered from the `tool/call` event that always precedes its dispatches in the log.
 *
 * A Definition is registered once on the shared event registry while every Session has its own assembler, and
 * `match()` sees no Session identity. Call ids may repeat across Sessions, so the map must not outlive the
 * event feed it was learned from: durable Session events carry a `seq` that rises strictly within one feed, so
 * a `seq` that goes back means a different feed (another Session, a reload or a window replacement) and
 * starts the map afresh. The owner also clears it when the Definition is unregistered.
 */
// Type-only: brings DSH's `tool/ptc-dispatch` session event types into this program.
import type {} from '@deepseek-ai/dsh-tools/types';

export type CallTurns = {
  /** Feed the `seq` of every durable event the Definition sees, in the order it sees them. */
  observe(seq: unknown): void;
  remember(callId: unknown, turn: unknown): void;
  turnOf(callId: unknown): number | undefined;
  clear(): void;
};

/** Bounded (oldest first out) so a long-lived Client never grows without limit; a lookup miss only skips display. */
export function createCallTurns(limit = 4096): CallTurns {
  const turns = new Map<string, number>();
  let lastSeq = -Infinity;
  return {
    observe(seq) {
      if (typeof seq !== 'number' || !Number.isFinite(seq)) return;
      // The same event may be matched more than once; only a seq that goes back is another feed.
      if (seq < lastSeq) turns.clear();
      lastSeq = seq;
    },
    remember(callId, turn) {
      if (typeof callId !== 'string' || !Number.isSafeInteger(turn)) return;
      // The latest call with an id wins: a dispatch always follows the call it belongs to.
      turns.delete(callId);
      turns.set(callId, turn as number);
      if (turns.size > limit) turns.delete(turns.keys().next().value as string);
    },
    turnOf(callId) {
      return typeof callId === 'string' ? turns.get(callId) : undefined;
    },
    clear() {
      turns.clear();
      lastSeq = -Infinity;
    },
  };
}
