import type { Session } from '@deepseek-ai/dsh-session';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { CompactionProvider, SourceDependency } from '#dafeiyu/contracts';
import type { ContextEvidenceView } from './context-runtime.js';
import type { HistoryFrame } from './history-frame.js';
import type { SourceRecord } from './source-records.js';
export * from './source-records.js';
type Binding = {
    owner: string;
    version: string;
    provider: CompactionProvider;
};
/** Immutable per-message provenance. Requests inherit every actually exposed input; model
 * citations never reduce this union. The reverse map is a rebuildable in-process index. */
export declare class SourceTracker {
    private readonly agentId;
    private readonly binding;
    private readonly context;
    private item;
    private session;
    private offset;
    private inputId;
    private admitted;
    private records;
    private indexed;
    private reverse;
    private validationStamp;
    private validationProvider;
    private validationCache;
    constructor(agentId: string, binding: () => Binding | undefined, context: ContextEvidenceView);
    begin(item: HistoryFrame, session: Session, offset: number): void;
    expectInput(id: string): void;
    end(): void;
    exposed(): readonly SourceDependency[];
    private scope;
    private common;
    private index;
    get(seq: number): SourceRecord | undefined;
    validate(dependencies: readonly SourceDependency[]): boolean;
    valid(record: SourceRecord): boolean;
    invalid(): Set<number>;
    private write;
    recordReplacement(seq: number, parentSeq: number): void;
    /** Capture completed outputs before any pruning; record input hashes at first dispatch. */
    sync(): void;
    dependenciesFor(seq: number, legacyEpoch?: string): SourceDependency[];
    admit(options: GenerateOptions, legacy: (seq: number) => string | undefined): void;
    private reject;
    guard(): void;
}
