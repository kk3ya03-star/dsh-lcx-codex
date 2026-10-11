/**
 * Nested (programmatic tool calling) settlements on the Client.
 *
 * DSH 0.2.1 records a tool a `run_code` program called as `tool/ptc-dispatch`, not as `tool/result`, and that
 * event names only the root `run_code` call: it carries no `turn`. A Conversation Definition's `match()` must
 * return its Context identity from the current event alone, and LCX's Contexts are keyed by turn, so the turn
 * of a root call is remembered from the `tool/call` event that always precedes its dispatches in the log.
 */
// Type-only: brings DSH's `tool/ptc-dispatch` session event types into this program.
import type {} from '@deepseek-ai/dsh-tools/types';

export type CallTurns = {
  remember(callId: unknown, turn: unknown): void;
  turnOf(callId: unknown): number | undefined;
};

/** Bounded (oldest first out) so a long-lived Client never grows without limit; a lookup miss only skips display. */
export function createCallTurns(limit = 4096): CallTurns {
  const turns = new Map<string, number>();
  return {
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
  };
}
