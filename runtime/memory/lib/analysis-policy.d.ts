import type { AnalysisJob, AnalysisResult, Candidate } from './analysis-types.js';
/** Model labels are proposals; exact spans, ownership and deterministic guards decide auto publication. */
export declare function candidates(job: AnalysisJob, result: AnalysisResult): Candidate[];
