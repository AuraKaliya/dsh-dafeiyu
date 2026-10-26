import type { OperationScope, TimelineScope } from '#dafeiyu/contracts';
import type { NewEvent } from '#dafeiyu/journal';
import type { NewExecutionEvent } from '#dafeiyu/contracts';
import type { Command, MutationReceipt, ReadMode, Revision } from './types.js';
import type { MemoryBoundary, MemoryAccessPurpose, MemoryWriteBinding } from '#dafeiyu/contracts';
import { ObservationStore } from './observations.js';
import { TaskWorkspace } from './task-workspace.js';
import { TaskMemory } from './task-memory.js';
import type { MemoryRetrieval } from './retrieval.js';
import type { Context } from '@deepseek-ai/cordis';
import { TaskExpression } from './expression.js';
import { PersonaStore } from './persona-store.js';
import type { PersonaResolver } from './persona-store.js';
import { ExecutionSources } from './execution-sources.js';
import { ExecutionMemoryState } from './execution-memory-state.js';
import { CapabilityObservations } from './capability-observations.js';
import { NativeExpression } from './native-expression.js';
import { ExperienceStore } from './experience-store.js';
export { PERSONA_ADOPTION_TABLES, verifyPersonaAdoptionSchema } from './migrate-persona-adoption.js';
export declare const MEMORY_APPLICATION_ID = 1145457969;
export declare const MEMORY_SCHEMA_VERSION = 12;
export interface MemoryView extends Revision {
    readonly boundary: MemoryBoundary;
    readonly effectiveAccess: Pick<MemoryBoundary, 'internalUse' | 'externalExpression'>;
    readonly observation?: unknown;
    readonly sourceVersions: readonly {
        id: string;
        revision: number;
        version: number;
        contentHash: string;
    }[];
    readonly ref: string;
    readonly version: number;
    readonly latestRevision: number;
    readonly validity: 'active' | 'superseded';
    readonly deleted: boolean;
    readonly effectivelyDeleted: boolean;
    readonly basisStatus: 'current' | 'changed' | 'deleted';
    readonly deletionReason: string | null;
    readonly untrustedEvidence: true;
    readonly useRestriction: 'evidence_only' | 'historical_evidence_only' | 'deleted_lookup_only';
}
export interface SearchInput {
    readonly query: string;
    readonly limit: number;
    readonly cursor?: string;
}
/** Trusted persistence API. Model-facing access must go through the core-bound MemoryService. */
export declare class MemoryStore {
    private readonly db;
    private closed;
    private transactionDepth;
    private taskSourceValidator;
    private readonly validatingTaskSources;
    private executionValidator;
    readonly observations: ObservationStore;
    readonly capabilities: CapabilityObservations;
    constructor(file: string);
    private transaction;
    taskWorkspace(timeline: (scope: TimelineScope, ref: string, hash: string) => boolean, sameSource: (scope: TimelineScope, a: string, b: string) => boolean): TaskWorkspace;
    taskSourceState(agentId: string, jobId: string, purpose?: MemoryAccessPurpose): 'valid' | 'deleted' | 'changed' | 'unavailable';
    taskMemory(tasks: TaskWorkspace, retrieval: MemoryRetrieval | null): TaskMemory;
    personaStore(resolve: PersonaResolver): PersonaStore;
    experienceStore(resolve: PersonaResolver): ExperienceStore;
    executionSources(resolve: PersonaResolver): ExecutionSources;
    executionState(sources: ExecutionSources, resolve: PersonaResolver): ExecutionMemoryState;
    /** Trusted same-store composition; callers must keep this synchronous. */
    atomic<T>(work: () => T): T;
    withExecutionValidator<T>(validator: NonNullable<MemoryStore['executionValidator']>, work: () => T): T;
    taskExpression(tasks: TaskWorkspace, ctx: Context): TaskExpression;
    nativeExpression(ctx: Context, expression: TaskExpression, ready: () => boolean, flush: () => void): NativeExpression;
    private item;
    generation(scope: TimelineScope): number;
    /** Monotonic invalidation epoch. Adding an unrelated memory does not erase valid conversation history. */
    mutationEpoch(scope: TimelineScope): number;
    /** Explicit state changes on memories directly grounded in this source form its fence.
     * Derived invalidity never flows backwards through a sibling input. */
    sourceFence(scope: TimelineScope, contentHash: string, matchesSource?: (ref: string) => boolean): string;
    provenance(scope: TimelineScope, id: string, revision: number, purpose?: MemoryAccessPurpose): MemoryView[];
    evidenceFences(scope: TimelineScope, id: string, revision: number, sameSource?: (left: string, right: string) => boolean, purpose?: MemoryAccessPurpose): {
        ref: string;
        contentHash: string;
        fence: string;
    }[];
    /** Conservative tombstone barrier: automatic extraction cannot resurrect deleted source material. */
    suppressedEvidence(scope: TimelineScope, contentHash: string, matchesSource?: (ref: string) => boolean): boolean;
    /** Trusted indexer enumeration: sources and tombstones are checked before any text is yielded. */
    current(scope: TimelineScope, purpose?: MemoryAccessPurpose): Generator<MemoryView>;
    /** Versioned source graph; UNION handles shared ancestry without infinite traversal. */
    private decodeBoundary;
    private boundary;
    private lineage;
    read(scope: TimelineScope, id: string, mode?: ReadMode, revision?: number, purpose?: MemoryAccessPurpose): MemoryView | null;
    search(scope: TimelineScope, mode: ReadMode, input: SearchInput): {
        generation: number;
        items: MemoryView[];
        nextCursor: string | null;
    };
    private validateSources;
    /** Recover a cross-store commit acknowledgement without disclosing a remembered text. */
    receipt(scope: TimelineScope, command: Command): MutationReceipt | null;
    mutate(scope: OperationScope, command: Command, binding?: MemoryWriteBinding): MutationReceipt & {
        duplicate: boolean;
    };
    /** At-least-once delivery with a stable event ID. Publishing must be idempotent. */
    drainOutbox(publish: (event: NewEvent, id: string) => void, publishExecution?: (event: NewExecutionEvent, id: string) => void): number;
    close(): void;
}
