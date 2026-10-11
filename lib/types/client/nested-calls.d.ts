export type CallTurns = {
    remember(callId: unknown, turn: unknown): void;
    turnOf(callId: unknown): number | undefined;
};
/** Bounded (oldest first out) so a long-lived Client never grows without limit; a lookup miss only skips display. */
export declare function createCallTurns(limit?: number): CallTurns;
