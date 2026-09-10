import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { Session, EpochHeader } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter';
import { type Buckets } from './search-accounting.js';
type SearchUsageState = {
    auxiliary: Buckets;
    aggregateContext: boolean;
    pending: Record<string, string>;
};
type SearchUsageView = Omit<SearchUsageState, 'pending'>;
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        lcxSearchUsage: SearchUsageState;
    }
    interface SessionProjectionMap {
        lcxSearchUsage: SearchUsageView;
    }
}
/** Separate, durable extension: the host's own usage projection remains primary-call billing. */
export declare const searchUsageProjection: {
    key: "lcxSearchUsage";
    stateVersion: number;
    stateSchema: z.ZodObject<{
        auxiliary: z.ZodObject<{
            uncachedInputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cacheReadTokens: z.ZodNumber;
            cacheWriteTokens: z.ZodNumber;
        }, z.core.$strict>;
        aggregateContext: z.ZodBoolean;
        pending: z.ZodRecord<z.ZodString, z.ZodString>;
    }, z.core.$strict>;
    init: () => {
        auxiliary: Buckets;
        aggregateContext: false;
        pending: {};
    };
    apply(state: SearchUsageState, event: Parameters<ProjectionDefinition<'lcxSearchUsage'>['apply']>[1]): SearchUsageState;
    wire: {
        viewSchema: z.ZodObject<{
            auxiliary: z.ZodObject<{
                uncachedInputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                cacheReadTokens: z.ZodNumber;
                cacheWriteTokens: z.ZodNumber;
            }, z.core.$strict>;
            aggregateContext: z.ZodBoolean;
        }, z.core.$strict>;
        view: ({ auxiliary, aggregateContext }: SearchUsageState) => {
            auxiliary: Buckets;
            aggregateContext: boolean;
        };
    };
};
type Meter = {
    measure(session: Session, header?: EpochHeader): TokenMeasurement;
};
/** Own a reversible adapter on the public measure method, never a DSH file or private fold. */
export declare function installSearchMeasurement(meter: Meter): () => void;
export declare function installSearchUsage(ctx: Context): void;
export {};
