import type { TimelineScope } from '#dafeiyu/contracts';
import type { AnalysisJob } from './analysis-types.js';
import type { NewEvent } from '#dafeiyu/journal';
/** Durable queue and candidate acknowledgements; memory commits use their own idempotency ledger. */
export declare class AnalysisStore {
    private readonly db;
    private readonly nonce;
    constructor(file: string, deferRecovery?: boolean);
    recover(): void;
    private decode;
    get(scope: TimelineScope, id: string): AnalysisJob | null;
    request(scope: TimelineScope, requestId: string, fingerprint: string): AnalysisJob | null;
    pending(): Generator<AnalysisJob>;
    firstPending(): AnalysisJob | null;
    insert(job: AnalysisJob): void;
    save(job: AnalysisJob): void;
    private transaction;
    private audit;
    flush(publish: (event: NewEvent, id: string) => void): number;
    close(): void;
}
