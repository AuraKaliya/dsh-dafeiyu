import type { Context } from '@deepseek-ai/cordis';
import type { PersonaAccess, PersonaSourceRef, ExecutionContextV3 } from '#dafeiyu/contracts';
import { z } from 'zod';
import type { MemoryStore } from './store.js';
import type { TaskWorkspace } from './task-workspace.js';
import type { PersonaMaterial } from './persona-store.js';
import type { compactionConfigSchema } from './compaction.js';
import type { ExperienceStore } from './experience-store.js';
/** Sole owner of stage-personality proposals, preferences and relationship state. */
export declare class GrowthService {
    private readonly ctx;
    private readonly memory;
    private readonly tasks;
    private readonly agentId;
    private readonly ready;
    readonly experiences: ExperienceStore;
    private readonly store;
    private readonly sources;
    private readonly resolving;
    private readonly unbind;
    private readonly unbindExecution;
    private readonly executionState;
    private readonly executionHandle;
    private readonly handle;
    constructor(ctx: Context, memory: MemoryStore, tasks: TaskWorkspace, agentId: string, ready: () => boolean, compaction?: z.input<typeof compactionConfigSchema>, maintenanceEnabled?: boolean);
    resolve(access: PersonaAccess, ref: PersonaSourceRef): PersonaMaterial | null;
    private access;
    /** A source key selects only a reference already exposed in this live execution access. */
    private resolveExposedSource;
    derive(access: PersonaAccess, requestId: string, text: string, refs: readonly PersonaSourceRef[]): {
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
    expose(access: PersonaAccess, ref: PersonaSourceRef): void;
    proposeAnalyzed(access: PersonaAccess, input: unknown): {
        id: `${string}-${string}-${string}-${string}-${string}`;
        version: number;
        state: string;
    };
    propose(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        id: `${string}-${string}-${string}-${string}-${string}`;
        version: number;
        state: string;
    };
    /** Trusted program adapter: references are still checked against the live execution scope. */
    proposeReference(context: ExecutionContextV3, raw: unknown, pluginId: string): {
        id: `${string}-${string}-${string}-${string}-${string}`;
        version: number;
        state: string;
    };
    review(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        id: string;
        version: number;
        state: "proposed" | "held" | "trial" | "adopted" | "rejected" | "withdrawn" | "dormant" | "superseded";
    };
    selectTrial(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        selection: {
            agentId: string;
            scopeKey: string;
            version: number;
            hash: string;
        };
        entries: {
            candidate: {
                id: string;
                version: number;
            };
            applicability: string;
            exitConditions: string[];
        }[];
    };
    reviewAdoption(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        review: {
            id: string;
            hash: string;
        };
        decision: {
            id: string;
            hash: string;
        };
        eligibility: "held" | "allowed";
        reasons: ("trial-evidence-missing" | "trial-not-closed" | "trial-not-used" | "source-stale" | "scope-mismatch" | "candidate-stale" | "counter-evidence-unresolved" | "coverage-insufficient" | "motivation-mismatch" | "maturity-unsupported" | "review-required")[];
        published: boolean;
    };
    publish(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        stageRevision: number;
        selectionVersion: number;
        entries: {
            id: string;
            version: number;
        }[];
    };
    select(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        selectionVersion: number;
    };
    withdraw(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        id: string;
        version: number;
        state: "withdrawn";
    };
    status(context: ExecutionContextV3, pluginId?: string): {
        trialSelectionVersion: number;
        trialSelection: {
            agentId: string;
            scopeKey: string;
            version: number;
            hash: string;
        } | null;
        trialEntries: {
            candidate: {
                id: string;
                version: number;
            };
            applicability: string;
            exitConditions: string[];
        }[];
        trialOutcomes: {
            ref: {
                id: string;
                hash: string;
            };
            candidate: {
                id: string;
                version: number;
            };
            runId: string;
            state: "completed" | "failed" | "cancelled" | "interrupted";
            gaps: string[];
        }[];
        stageRevision: number;
        selectionVersion: number;
        legacySelection: boolean;
        candidates: {
            id: string;
            version: number;
            state: "proposed" | "held" | "trial" | "adopted" | "rejected" | "withdrawn" | "dormant" | "superseded";
            kind: "interest" | "preference" | "view" | "habit" | "relationship" | "value-application";
            applicability: string;
            maturity: string;
            available: boolean;
        }[];
    };
    recordObservation(context: ExecutionContextV3, raw: unknown, pluginId: string): {
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
    openSource(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        source: {
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
        view: string;
        rawAvailable: boolean;
        text: string;
        offset: number;
        end: number;
        total: number;
        nextOffset: number | null;
        sourceKind: string;
        sourceCompleteness: "unknown" | "complete" | "partial";
        coverage: string[];
        pageCompleteness: string;
    };
    contribute(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        id: string;
        revision: number;
        version: number;
        eventId: string;
        duplicate: boolean;
        source: {
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
        generation?: number | undefined;
    };
    selectEvidence(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        kind: "execution-selection";
        version: number;
        entries: ({
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
        })[];
    };
    changeSource(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        id: string;
        version: number;
    };
    changeContribution(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        id: string;
        version: number;
        revision: number;
        eventId: string;
        generation?: number | undefined;
    } & {
        duplicate: boolean;
    };
    object(context: ExecutionContextV3, raw: unknown, pluginId?: string): {
        schemaVersion: 1;
        id: string;
        agentId: string;
        taskId: string;
        taskEpoch: number;
        runId: string;
        requestId: string;
        producer: string;
        kind: "accepted" | "objection" | "resolved";
        motivation: {
            kind: "unknown" | "explicit-task" | "self-exploration" | "conversation-invitation" | "maintenance" | "mixed";
            basis: string[];
        };
        category: "preference" | "scope" | "none" | "method" | "premise" | "missing-information";
        blocking: boolean;
        reason: string;
        evidence: ({
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
        })[];
        resolves: string | null;
        createdAt: string;
        actions?: string[] | undefined;
        historyHash?: string | undefined;
    };
    intent(context: ExecutionContextV3, pluginId?: string): {
        motivation: {
            kind: "unknown" | "explicit-task" | "self-exploration" | "conversation-invitation" | "maintenance" | "mixed";
            basis: string[];
        };
        blocking: boolean;
        events: {
            schemaVersion: 1;
            id: string;
            agentId: string;
            taskId: string;
            taskEpoch: number;
            runId: string;
            requestId: string;
            producer: string;
            kind: "accepted" | "objection" | "resolved";
            motivation: {
                kind: "unknown" | "explicit-task" | "self-exploration" | "conversation-invitation" | "maintenance" | "mixed";
                basis: string[];
            };
            category: "preference" | "scope" | "none" | "method" | "premise" | "missing-information";
            blocking: boolean;
            reason: string;
            evidence: ({
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
            })[];
            resolves: string | null;
            createdAt: string;
            actions?: string[] | undefined;
            historyHash?: string | undefined;
        }[];
    };
    private executionActions;
    private actions;
    flush(): number;
    close(): void;
}
/** @deprecated Use GrowthService. This is the same constructor, not a second store. */
export { GrowthService as PersonaService };
