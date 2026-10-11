export type CallTurns = {
    /** Feed the `seq` of every durable event the Definition sees, in the order it sees them. */
    observe(seq: unknown): void;
    remember(callId: unknown, turn: unknown): void;
    turnOf(callId: unknown): number | undefined;
    clear(): void;
};
/** Bounded (oldest first out) so a long-lived Client never grows without limit; a lookup miss only skips display. */
export declare function createCallTurns(limit?: number): CallTurns;
