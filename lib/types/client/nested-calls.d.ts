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
export declare function createCallTurns(limit?: number): CallTurns;
