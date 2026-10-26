import type { ActivityAnchor } from '#dafeiyu/contracts';
import type { PersonaAccess, PersonaSourceRef, ExecutionMemoryPort, SourceDependency, CompactionProvider, ContextItem, TaskRepositoryPort } from '#dafeiyu/contracts';
import type { RuntimeStore, StoredRun } from './runtime-store.js';
import type { PersonaRuntime } from './persona-runtime.js';
import type { CapabilityRegistryV3 } from './registry-v3.js';
import type { ContextEvidenceView } from './context-runtime.js';
export interface NativeContext {
    owner: string;
    region: string;
    item: ContextItem;
}
/** Source proofs refer to real native task inputs and persisted operation outcomes. */
export declare class ExecutionEvidence {
    readonly run: StoredRun;
    private readonly store;
    private readonly memory;
    private readonly personas;
    private readonly registry;
    private readonly repository;
    private readonly rules;
    private readonly base;
    private readonly authorityValid;
    private readonly authorityRequired;
    private admitted;
    private contexts;
    private readonly checking;
    private readonly validationMemo;
    private validationDepth;
    private invalidated;
    private bound;
    constructor(run: StoredRun, store: RuntimeStore, memory: () => ExecutionMemoryPort | undefined, personas: PersonaRuntime, registry: CapabilityRegistryV3, repository: TaskRepositoryPort, rules: readonly string[], base: PersonaAccess, authorityValid?: (anchor: ActivityAnchor) => boolean, authorityRequired?: (run: StoredRun) => boolean);
    access(base?: PersonaAccess): PersonaAccess;
    recordInput(input: unknown, sources: readonly PersonaSourceRef[], continuity: {
        id: string;
        hash: string;
    } | null, authorities?: readonly ActivityAnchor[]): void;
    setContexts(contexts: NativeContext[]): void;
    private dependency;
    private route;
    private unavailable;
    expose(value: readonly SourceDependency[]): void;
    invalidate(): void;
    exposed(): readonly ({
        kind: "capability";
        ref: {
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        };
        agentId: string;
        route: string;
    } | {
        kind: "execution-source";
        ref: {
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        };
        agentId: string;
        route: string;
    } | {
        kind: "execution-input";
        runId: string;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "execution-operation";
        runId: string;
        operationId: string;
        hash: string;
        inputHash: string;
        agentId: string;
        route: string;
    } | {
        kind: "memory";
        id: string;
        revision: number;
        version: number;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "inbound";
        id: string;
        hash: string;
        fence: string;
        agentId: string;
        route: string;
    } | {
        kind: "timeline";
        ref: string;
        hash: string;
        fence: string;
        agentId: string;
        route: string;
    } | {
        kind: "working";
        id: string;
        taskId: string;
        revision: number;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "feedback";
        id: string;
        version: number;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "context";
        owner: string;
        region: string;
        id: string;
        version: string;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "legacy";
        epoch: string;
        agentId: string;
        route: string;
    } | {
        kind: "ephemeral";
        traceId: string;
        agentId: string;
        route: string;
    } | {
        kind: "unavailable";
        reason: string;
        agentId: string;
        route: string;
    })[];
    contextView(): ContextEvidenceView;
    sourceRefs(deps?: readonly ({
        kind: "capability";
        ref: {
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        };
        agentId: string;
        route: string;
    } | {
        kind: "execution-source";
        ref: {
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        };
        agentId: string;
        route: string;
    } | {
        kind: "execution-input";
        runId: string;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "execution-operation";
        runId: string;
        operationId: string;
        hash: string;
        inputHash: string;
        agentId: string;
        route: string;
    } | {
        kind: "memory";
        id: string;
        revision: number;
        version: number;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "inbound";
        id: string;
        hash: string;
        fence: string;
        agentId: string;
        route: string;
    } | {
        kind: "timeline";
        ref: string;
        hash: string;
        fence: string;
        agentId: string;
        route: string;
    } | {
        kind: "working";
        id: string;
        taskId: string;
        revision: number;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "feedback";
        id: string;
        version: number;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "context";
        owner: string;
        region: string;
        id: string;
        version: string;
        hash: string;
        agentId: string;
        route: string;
    } | {
        kind: "legacy";
        epoch: string;
        agentId: string;
        route: string;
    } | {
        kind: "ephemeral";
        traceId: string;
        agentId: string;
        route: string;
    } | {
        kind: "unavailable";
        reason: string;
        agentId: string;
        route: string;
    })[]): PersonaSourceRef[];
    validate(deps: readonly SourceDependency[]): boolean;
    private valid;
    binding(): {
        owner: string;
        version: string;
        provider: CompactionProvider;
    };
}
