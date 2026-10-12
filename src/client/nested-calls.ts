/**
 * Nested (programmatic tool calling) settlements on the Client.
 *
 * DSH 0.2.1 records a tool a `run_code` program called as `tool/ptc-dispatch`, not as `tool/result`, and that
 * event names only the root `run_code` call: it carries no `turn`. A Conversation Definition's `match()` must
 * return its Context identity from the current event alone, and LCX's Contexts are keyed by turn, so the turn
 * of a root call is remembered from the `tool/call` event that always precedes its dispatches in the log.
 *
 * A Definition is registered once on the shared event registry while every Session has its own assembler, and
 * `match()` receives the bare event: no Session id, no assembler, no store (checked: events carry none, DSH's
 * `ConversationNodeAssembler` calls `definition.match(event)` with nothing else, and the per-Session assembler is
 * created inside `uiConversation.binding()` where a Definition cannot reach it). Call ids may repeat across
 * Sessions, so what a root call may be matched with is bounded by the log's own structure instead:
 *   - a dispatch is settled while its root call runs, so it always precedes the `turn/end` of that call's turn:
 *     the roots of a turn are forgotten when the turn ends, and a new `turn/start` forgets every other turn's;
 *     the map therefore only ever holds the roots of the turn that is open in the current feed;
 *   - durable events carry a `seq` that rises within one feed, so a `seq` that goes back is another feed (a
 *     Session switch, a reload) and starts the map afresh;
 *   - the owner clears the map when the Definition is unregistered.
 * Not guaranteed: a feed that ends inside an open turn followed by a different Session's mid-turn window that
 * repeats the call id of a root it does not contain. Without a Session identity on the Client the two cannot be told apart.
 */
// Type-only: brings DSH's `tool/ptc-dispatch` session event types into this program.
import type {} from '@deepseek-ai/dsh-tools/types';

export type CallTurns = {
  /** Feed the `seq` of every durable event the Definition sees, in the order it sees them. */
  observe(seq: unknown): void;
  /** A `turn/start`: only this turn can have a running root call. */
  openTurn(turn: unknown): void;
  /** A `turn/end`: no call of this turn can be settled any more. */
  closeTurn(turn: unknown): void;
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
    openTurn(turn) {
      for (const [callId, remembered] of turns) if (remembered !== turn) turns.delete(callId);
    },
    closeTurn(turn) {
      for (const [callId, remembered] of turns) if (remembered === turn) turns.delete(callId);
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
