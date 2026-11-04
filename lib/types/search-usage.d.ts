import type { Context } from '@deepseek-ai/cordis';
import type { Session, EpochHeader } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter';
import { type Buckets, type ProviderContextDetails } from './search-accounting.js';
type SearchUsageState = {
    auxiliary: Buckets;
    aggregateContext: boolean;
    pending: Record<string, string>;
    headerKey?: string;
    sampleHeaderKey?: string;
    contextDetails?: ProviderContextDetails;
    contextProvenance?: 'provider-context-details';
};
type SearchUsageView = Omit<SearchUsageState, 'pending' | 'headerKey' | 'sampleHeaderKey'>;
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        lcxSearchUsage: SearchUsageState;
    }
    interface SessionProjectionMap {
        lcxSearchUsage: SearchUsageView;
    }
}
type Definition = ProjectionDefinition<'lcxSearchUsage'> & {
    wire: NonNullable<ProjectionDefinition<'lcxSearchUsage'>['wire']>;
};
/** Separate, durable extension: the host's own usage projection remains primary-call billing. */
export declare const searchUsageProjection: Definition;
type Meter = {
    measure(session: Session, header?: EpochHeader): TokenMeasurement;
};
type SessionProjections = {
    stateOf(session: Session, key: string): unknown;
};
/** Own a reversible adapter on the public measure method, never a DSH file or private fold. */
export declare function installSearchMeasurement(meter: Meter, projections: SessionProjections): () => void;
export declare function installSearchUsage(ctx: Context): void;
export {};
