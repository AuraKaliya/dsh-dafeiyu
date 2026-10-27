import { z } from 'zod';
import type { Command, MutationReceipt } from './types.js';
import type { OperationScope } from '#dafeiyu/contracts';
export declare const analysisConfigSchema: z.ZodObject<{
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    maxPending: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export declare const submitSchema: z.ZodObject<{
    requestId: z.ZodString;
    sourceRefs: z.ZodArray<z.ZodString>;
    targetIds: z.ZodDefault<z.ZodArray<z.ZodUUID>>;
}, z.core.$strict>;
export declare const resultSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    overview: z.ZodString;
    gaps: z.ZodArray<z.ZodString>;
    claims: z.ZodArray<z.ZodObject<{
        action: z.ZodEnum<{
            revise: "revise";
            none: "none";
            add: "add";
        }>;
        kind: z.ZodEnum<{
            experience: "experience";
            knowledge: "knowledge";
            preference: "preference";
            procedure: "procedure";
        }>;
        claimType: z.ZodEnum<{
            observation: "observation";
            self_report: "self_report";
            reported_claim: "reported_claim";
            inference: "inference";
        }>;
        subject: z.ZodString;
        content: z.ZodString;
        support: z.ZodArray<z.ZodObject<{
            sourceId: z.ZodString;
            quote: z.ZodString;
        }, z.core.$strict>>;
        opposition: z.ZodArray<z.ZodObject<{
            sourceId: z.ZodString;
            quote: z.ZodString;
        }, z.core.$strict>>;
        uncertainties: z.ZodArray<z.ZodString>;
        explicit: z.ZodBoolean;
        temporal: z.ZodEnum<{
            durable: "durable";
            temporary: "temporary";
            uncertain: "uncertain";
        }>;
        targetId: z.ZodNullable<z.ZodUUID>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type AnalysisResult = z.infer<typeof resultSchema>;
export type Claim = AnalysisResult['claims'][number];
export declare const sourceSchema: z.ZodObject<{
    sourceId: z.ZodString;
    evidence: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"capability">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"observation">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"timeline">;
        ref: z.ZodString;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        id: z.ZodUUID;
        revision: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    text: z.ZodString;
    origin: z.ZodEnum<{
        memory: "memory";
        user: "user";
        tool: "tool";
        event: "event";
    }>;
    authorId: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type AnalysisSource = z.infer<typeof sourceSchema>;
declare const targetItemSchema: z.ZodObject<{
    id: z.ZodUUID;
    revision: z.ZodNumber;
    kind: z.ZodEnum<{
        experience: "experience";
        knowledge: "knowledge";
        preference: "preference";
        procedure: "procedure";
    }>;
    claimType: z.ZodEnum<{
        observation: "observation";
        self_report: "self_report";
        reported_claim: "reported_claim";
        inference: "inference";
    }>;
    content: z.ZodString;
    contentHash: z.ZodString;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"capability">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"observation">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"timeline">;
        ref: z.ZodString;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        id: z.ZodUUID;
        revision: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    createdAt: z.ZodISODateTime;
    analysisStatus: z.ZodEnum<{
        not_analyzed: "not_analyzed";
        evidence_checked: "evidence_checked";
    }>;
    analysis: z.ZodOptional<z.ZodObject<{
        jobId: z.ZodUUID;
        candidateId: z.ZodUUID;
        policyVersion: z.ZodLiteral<"literal-evidence-v1">;
    }, z.core.$strict>>;
    version: z.ZodNumber;
}, z.core.$strict>;
export interface Target {
    item: z.infer<typeof targetItemSchema>;
    authorIds: string[];
}
export interface ModelRoute {
    provider: string;
    model: string;
    reasoningEffort?: string | undefined;
}
export interface Candidate {
    id: string;
    claim: Claim;
    status: 'needs_review' | 'ready' | 'committed' | 'duplicate' | 'stale';
    reason: string;
    command?: Extract<Command, {
        action: 'create' | 'revise';
    }> | undefined;
    receipt?: MutationReceipt | undefined;
}
export interface AnalysisJob {
    id: string;
    requestId: string;
    fingerprint: string;
    grantId: string;
    authority: OperationScope;
    agentId: string;
    route: string;
    model: ModelRoute;
    inputGeneration: number;
    generation: number;
    state: 'queued' | 'running' | 'committing' | 'completed' | 'failed' | 'cancelled';
    sources: AnalysisSource[];
    targets: Target[];
    result?: AnalysisResult | undefined;
    candidates: Candidate[];
    error?: string | undefined;
    createdAt: string;
    updatedAt: string;
    attempts: number;
}
export declare class AnalysisError extends Error {
    readonly code: 'queue_full' | 'idempotency_conflict' | 'source_unavailable' | 'target_unavailable' | 'input_too_large' | 'version_conflict' | 'source_changed' | 'deleted_source' | 'invalid_result' | 'model_failed' | 'checkpoint_unavailable' | 'invalid_evidence' | 'invalid_receipt' | 'model_route_changed' | 'worker_unavailable' | 'authorization_unavailable';
    constructor(code: 'queue_full' | 'idempotency_conflict' | 'source_unavailable' | 'target_unavailable' | 'input_too_large' | 'version_conflict' | 'source_changed' | 'deleted_source' | 'invalid_result' | 'model_failed' | 'checkpoint_unavailable' | 'invalid_evidence' | 'invalid_receipt' | 'model_route_changed' | 'worker_unavailable' | 'authorization_unavailable');
}
export declare const authoritySchema: z.ZodObject<{
    agentId: z.ZodString;
    route: z.ZodString;
    traceId: z.ZodString;
    operationId: z.ZodString;
    startedEventId: z.ZodString;
}, z.core.$strict>;
export declare const jobSchema: z.ZodObject<{
    id: z.ZodUUID;
    requestId: z.ZodString;
    fingerprint: z.ZodString;
    grantId: z.ZodUUID;
    agentId: z.ZodString;
    route: z.ZodString;
    authority: z.ZodObject<{
        agentId: z.ZodString;
        route: z.ZodString;
        traceId: z.ZodString;
        operationId: z.ZodString;
        startedEventId: z.ZodString;
    }, z.core.$strict>;
    model: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    inputGeneration: z.ZodNumber;
    generation: z.ZodNumber;
    state: z.ZodEnum<{
        queued: "queued";
        running: "running";
        committing: "committing";
        completed: "completed";
        failed: "failed";
        cancelled: "cancelled";
    }>;
    sources: z.ZodArray<z.ZodObject<{
        sourceId: z.ZodString;
        evidence: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"capability">;
            ref: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution">;
            ref: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"observation">;
            ref: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"timeline">;
            ref: z.ZodString;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            id: z.ZodUUID;
            revision: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        text: z.ZodString;
        origin: z.ZodEnum<{
            memory: "memory";
            user: "user";
            tool: "tool";
            event: "event";
        }>;
        authorId: z.ZodOptional<z.ZodString>;
        version: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    targets: z.ZodArray<z.ZodObject<{
        item: z.ZodObject<{
            id: z.ZodUUID;
            revision: z.ZodNumber;
            kind: z.ZodEnum<{
                experience: "experience";
                knowledge: "knowledge";
                preference: "preference";
                procedure: "procedure";
            }>;
            claimType: z.ZodEnum<{
                observation: "observation";
                self_report: "self_report";
                reported_claim: "reported_claim";
                inference: "inference";
            }>;
            content: z.ZodString;
            contentHash: z.ZodString;
            sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"capability">;
                ref: z.ZodString;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"execution">;
                ref: z.ZodString;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"observation">;
                ref: z.ZodString;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"timeline">;
                ref: z.ZodString;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"memory">;
                id: z.ZodUUID;
                revision: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>], "kind">>;
            createdAt: z.ZodISODateTime;
            analysisStatus: z.ZodEnum<{
                not_analyzed: "not_analyzed";
                evidence_checked: "evidence_checked";
            }>;
            analysis: z.ZodOptional<z.ZodObject<{
                jobId: z.ZodUUID;
                candidateId: z.ZodUUID;
                policyVersion: z.ZodLiteral<"literal-evidence-v1">;
            }, z.core.$strict>>;
            version: z.ZodNumber;
        }, z.core.$strict>;
        authorIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    result: z.ZodOptional<z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        overview: z.ZodString;
        gaps: z.ZodArray<z.ZodString>;
        claims: z.ZodArray<z.ZodObject<{
            action: z.ZodEnum<{
                revise: "revise";
                none: "none";
                add: "add";
            }>;
            kind: z.ZodEnum<{
                experience: "experience";
                knowledge: "knowledge";
                preference: "preference";
                procedure: "procedure";
            }>;
            claimType: z.ZodEnum<{
                observation: "observation";
                self_report: "self_report";
                reported_claim: "reported_claim";
                inference: "inference";
            }>;
            subject: z.ZodString;
            content: z.ZodString;
            support: z.ZodArray<z.ZodObject<{
                sourceId: z.ZodString;
                quote: z.ZodString;
            }, z.core.$strict>>;
            opposition: z.ZodArray<z.ZodObject<{
                sourceId: z.ZodString;
                quote: z.ZodString;
            }, z.core.$strict>>;
            uncertainties: z.ZodArray<z.ZodString>;
            explicit: z.ZodBoolean;
            temporal: z.ZodEnum<{
                durable: "durable";
                temporary: "temporary";
                uncertain: "uncertain";
            }>;
            targetId: z.ZodNullable<z.ZodUUID>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    candidates: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        claim: z.ZodObject<{
            action: z.ZodEnum<{
                revise: "revise";
                none: "none";
                add: "add";
            }>;
            kind: z.ZodEnum<{
                experience: "experience";
                knowledge: "knowledge";
                preference: "preference";
                procedure: "procedure";
            }>;
            claimType: z.ZodEnum<{
                observation: "observation";
                self_report: "self_report";
                reported_claim: "reported_claim";
                inference: "inference";
            }>;
            subject: z.ZodString;
            content: z.ZodString;
            support: z.ZodArray<z.ZodObject<{
                sourceId: z.ZodString;
                quote: z.ZodString;
            }, z.core.$strict>>;
            opposition: z.ZodArray<z.ZodObject<{
                sourceId: z.ZodString;
                quote: z.ZodString;
            }, z.core.$strict>>;
            uncertainties: z.ZodArray<z.ZodString>;
            explicit: z.ZodBoolean;
            temporal: z.ZodEnum<{
                durable: "durable";
                temporary: "temporary";
                uncertain: "uncertain";
            }>;
            targetId: z.ZodNullable<z.ZodUUID>;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            needs_review: "needs_review";
            ready: "ready";
            committed: "committed";
            duplicate: "duplicate";
            stale: "stale";
        }>;
        reason: z.ZodString;
        command: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            action: z.ZodLiteral<"create">;
            requestId: z.ZodString;
            expectedGeneration: z.ZodNumber;
            value: z.ZodObject<{
                kind: z.ZodEnum<{
                    experience: "experience";
                    knowledge: "knowledge";
                    preference: "preference";
                    procedure: "procedure";
                }>;
                claimType: z.ZodEnum<{
                    observation: "observation";
                    self_report: "self_report";
                    reported_claim: "reported_claim";
                    inference: "inference";
                }>;
                content: z.ZodString;
                sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"capability">;
                    ref: z.ZodString;
                    version: z.ZodNumber;
                    contentHash: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"execution">;
                    ref: z.ZodString;
                    version: z.ZodNumber;
                    contentHash: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"observation">;
                    ref: z.ZodString;
                    version: z.ZodNumber;
                    contentHash: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"timeline">;
                    ref: z.ZodString;
                    contentHash: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"memory">;
                    id: z.ZodUUID;
                    revision: z.ZodNumber;
                    contentHash: z.ZodString;
                }, z.core.$strict>], "kind">>;
                analysis: z.ZodObject<{
                    jobId: z.ZodUUID;
                    candidateId: z.ZodUUID;
                    policyVersion: z.ZodLiteral<"literal-evidence-v1">;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"revise">;
            id: z.ZodUUID;
            expectedVersion: z.ZodNumber;
            requestId: z.ZodString;
            expectedGeneration: z.ZodNumber;
            value: z.ZodObject<{
                kind: z.ZodEnum<{
                    experience: "experience";
                    knowledge: "knowledge";
                    preference: "preference";
                    procedure: "procedure";
                }>;
                claimType: z.ZodEnum<{
                    observation: "observation";
                    self_report: "self_report";
                    reported_claim: "reported_claim";
                    inference: "inference";
                }>;
                content: z.ZodString;
                sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"capability">;
                    ref: z.ZodString;
                    version: z.ZodNumber;
                    contentHash: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"execution">;
                    ref: z.ZodString;
                    version: z.ZodNumber;
                    contentHash: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"observation">;
                    ref: z.ZodString;
                    version: z.ZodNumber;
                    contentHash: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"timeline">;
                    ref: z.ZodString;
                    contentHash: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"memory">;
                    id: z.ZodUUID;
                    revision: z.ZodNumber;
                    contentHash: z.ZodString;
                }, z.core.$strict>], "kind">>;
                analysis: z.ZodObject<{
                    jobId: z.ZodUUID;
                    candidateId: z.ZodUUID;
                    policyVersion: z.ZodLiteral<"literal-evidence-v1">;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>], "action">>;
        receipt: z.ZodOptional<z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
            revision: z.ZodNumber;
            eventId: z.ZodUUID;
            generation: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    error: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    attempts: z.ZodNumber;
}, z.core.$strict>;
export declare const targetSnapshot: (item: unknown) => {
    id: string;
    revision: number;
    kind: "experience" | "knowledge" | "preference" | "procedure";
    claimType: "observation" | "self_report" | "reported_claim" | "inference";
    content: string;
    contentHash: string;
    sources: ({
        kind: "capability";
        ref: string;
        version: number;
        contentHash: string;
    } | {
        kind: "execution";
        ref: string;
        version: number;
        contentHash: string;
    } | {
        kind: "observation";
        ref: string;
        version: number;
        contentHash: string;
    } | {
        kind: "timeline";
        ref: string;
        contentHash: string;
    } | {
        kind: "memory";
        id: string;
        revision: number;
        contentHash: string;
    })[];
    createdAt: string;
    analysisStatus: "not_analyzed" | "evidence_checked";
    version: number;
    analysis?: {
        jobId: string;
        candidateId: string;
        policyVersion: "literal-evidence-v1";
    } | undefined;
};
export {};
