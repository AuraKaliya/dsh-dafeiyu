import type { NewExecutionEvent, ExecutionEvent } from '#dafeiyu/contracts';
export { inspectJournal, JOURNAL_APPLICATION_ID } from './schema.js';
export { configureSqlite } from './sqlite.js';
import type { TimelineQuery, TimelineScope } from '#dafeiyu/contracts';
import type { EventRecord, InboundMessage, Json, MessageState, PendingMessage, Receipt, Reply, SourceRef } from '#dafeiyu/contracts';
export type NewEvent = Omit<EventRecord, 'seq' | 'id' | 'recordedAt' | 'visibility' | 'schemaVersion'>;
/** Single-process durable workflow ledger. DSH remains the owner of full session history. */
export declare class Journal {
    private readonly db;
    private readonly owner;
    private closed;
    constructor(file: string);
    private transaction;
    /** Persists acceptance and its audit event in the same transaction; conflicting duplicates fail. */
    accept(agentId: string, extensionId: string, version: string, message: InboundMessage): Receipt;
    append(input: NewEvent): EventRecord;
    appendExecutionOnce(raw: NewExecutionEvent, id: string): ExecutionEvent;
    /** Trusted native API. A model-facing caller must obtain its task scope from the core. */
    executionEvents(agentId: string, taskId: string): ExecutionEvent[];
    /** Bounded program-state receipts for one Run; never returns message or operation bodies. */
    executionRunStates(agentId: string, taskId: string, runId: string): {
        id: string;
        type: "run.running" | "run.completed" | "run.waiting" | "run.failed" | "run.cancelled" | "run.interrupted";
        at: string;
    }[];
    /** Trusted outbox publishers supply a stable UUID; duplicates never create a second event. */
    appendOnce(input: NewEvent, id: string): EventRecord;
    /** State and causal event move together. CAS prevents stale completion overwriting a newer state. */
    transition(id: string, from: MessageState, to: MessageState, event: NewEvent, reply?: Reply): EventRecord;
    get(id: string): PendingMessage;
    list(statesToRead?: readonly MessageState[]): PendingMessage[];
    latestMessageId(route: string): string | null;
    /** Scope filtering happens in the query, before exposing event bodies. No global model-facing query. */
    events(route: string): EventRecord[];
    /** Authorization predicates are evaluated inside the SQL query, including persisted visibility. */
    private scopePredicate;
    scopedEvent(scope: TimelineScope, id: string): EventRecord | null;
    issueAnalysisGrant(scope: import('#dafeiyu/contracts').OperationScope, pluginVersion?: string): string;
    analysisGrant(agentId: string, id: string): {
        agentId: string;
        route: string;
        traceId: string;
        operationId: string;
        startedEventId: string;
    } | null;
    revokeAnalysisGrant(agentId: string, id: string): void;
    private eventRow;
    sessionFor(scope: TimelineScope): string | null;
    messageFor(scope: TimelineScope, messageId: string): PendingMessage | null;
    /** Revocation facts remain in the audit log; the original inbox row is not erased. */
    messageRecalled(scope: TimelineScope, messageId: string): boolean;
    messageSourceEpoch(scope: TimelineScope): number;
    /** Snapshot keyset pagination. Cursor binds the scope and normalized query; it grants no access. */
    searchTimeline(scope: TimelineScope, input: TimelineQuery): {
        items: EventRecord[];
        snapshot: number;
        nextCursor: string | null;
    };
    close(): void;
}
/** Builds metadata without recording raw exception text, tool arguments, or tool results. */
export declare function eventFor(agentId: string, item: PendingMessage, type: string, plugin: string, pluginVersion: string, operationId?: string, causedBy?: string | null, data?: Record<string, Json>, sources?: SourceRef[]): NewEvent;
