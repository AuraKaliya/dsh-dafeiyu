import { z } from 'zod';
import type { ExecutionView } from './execution.js';
import type { ExecutionInput } from './execution-ports.js';
import type { ContextItem } from './context.js';
import type { SourceDependency } from './compaction.js';
export declare const PersonaRequestIdSchema: z.ZodString;
export declare const PersonaRecordRefSchema: z.ZodObject<{
    id: z.ZodUUID;
    hash: z.ZodString;
}, z.core.$strict>;
export type PersonaRecordRef = z.infer<typeof PersonaRecordRefSchema>;
export declare const PersonaTrialAdmissionRefSchema: z.ZodObject<{
    id: z.ZodUUID;
    hash: z.ZodString;
}, z.core.$strict>;
export type PersonaTrialAdmissionRef = z.infer<typeof PersonaTrialAdmissionRefSchema>;
export declare const PersonaTrialOutcomeRefSchema: z.ZodObject<{
    id: z.ZodUUID;
    hash: z.ZodString;
}, z.core.$strict>;
export type PersonaTrialOutcomeRef = z.infer<typeof PersonaTrialOutcomeRefSchema>;
export declare const PersonaAdoptionReviewRefSchema: z.ZodObject<{
    id: z.ZodUUID;
    hash: z.ZodString;
}, z.core.$strict>;
export type PersonaAdoptionReviewRef = z.infer<typeof PersonaAdoptionReviewRefSchema>;
export declare const PersonaAdoptionDecisionRefSchema: z.ZodObject<{
    id: z.ZodUUID;
    hash: z.ZodString;
}, z.core.$strict>;
export type PersonaAdoptionDecisionRef = z.infer<typeof PersonaAdoptionDecisionRefSchema>;
export declare const PersonaMaturitySchema: z.ZodEnum<{
    tentative: "tentative";
    established: "established";
    "legacy-unclassified": "legacy-unclassified";
}>;
export type PersonaMaturity = z.infer<typeof PersonaMaturitySchema>;
export declare const PersonaNewMaturitySchema: z.ZodEnum<{
    tentative: "tentative";
    established: "established";
}>;
export type PersonaNewMaturity = z.infer<typeof PersonaNewMaturitySchema>;
export declare const PersonaAdoptionClassificationSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    basis: z.ZodLiteral<"legacy-unclassified">;
    maturity: z.ZodLiteral<"legacy-unclassified">;
}, z.core.$strict>, z.ZodObject<{
    basis: z.ZodLiteral<"reviewed">;
    maturity: z.ZodEnum<{
        tentative: "tentative";
        established: "established";
    }>;
    review: z.ZodObject<{
        id: z.ZodUUID;
        hash: z.ZodString;
    }, z.core.$strict>;
    decision: z.ZodObject<{
        id: z.ZodUUID;
        hash: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>], "basis">;
export type PersonaAdoptionClassification = z.infer<typeof PersonaAdoptionClassificationSchema>;
export declare const PersonaSourceRefSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"memory">;
    revision: z.ZodNumber;
    authorization: z.ZodOptional<z.ZodObject<{
        taskId: z.ZodUUID;
        taskEpoch: z.ZodNumber;
        grantId: z.ZodUUID;
        grantVersion: z.ZodNumber;
        policyId: z.ZodString;
        policyVersion: z.ZodNumber;
    }, z.core.$strict>>;
    selectionId: z.ZodOptional<z.ZodUUID>;
    range: z.ZodOptional<z.ZodObject<{
        start: z.ZodNumber;
        end: z.ZodNumber;
    }, z.core.$strict>>;
    id: z.ZodUUID;
    agentId: z.ZodString;
    scopeKey: z.ZodString;
    version: z.ZodNumber;
    contentHash: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"execution-source">;
    id: z.ZodUUID;
    agentId: z.ZodString;
    scopeKey: z.ZodString;
    version: z.ZodNumber;
    contentHash: z.ZodString;
}, z.core.$strict>], "kind">;
export type PersonaSourceRef = z.infer<typeof PersonaSourceRefSchema>;
/** Assigned by a trusted source producer/resolver, never inferred from a model's reason text. */
export declare const PersonaSourceNatureSchema: z.ZodEnum<{
    unknown: "unknown";
    observed: "observed";
    synthetic: "synthetic";
    hypothetical: "hypothetical";
    "self-report": "self-report";
    derived: "derived";
}>;
export type PersonaSourceNature = z.infer<typeof PersonaSourceNatureSchema>;
export declare const PersonaSourceEvidenceSchema: z.ZodObject<{
    source: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    nature: z.ZodEnum<{
        unknown: "unknown";
        observed: "observed";
        synthetic: "synthetic";
        hypothetical: "hypothetical";
        "self-report": "self-report";
        derived: "derived";
    }>;
    coverage: z.ZodArray<z.ZodString>;
    completeness: z.ZodEnum<{
        unknown: "unknown";
        complete: "complete";
        partial: "partial";
    }>;
    roots: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        nature: z.ZodEnum<{
            unknown: "unknown";
            observed: "observed";
            synthetic: "synthetic";
            hypothetical: "hypothetical";
            "self-report": "self-report";
            derived: "derived";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type PersonaSourceEvidence = z.infer<typeof PersonaSourceEvidenceSchema>;
export declare const MotivationSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        unknown: "unknown";
        "explicit-task": "explicit-task";
        "self-exploration": "self-exploration";
        "conversation-invitation": "conversation-invitation";
        maintenance: "maintenance";
        mixed: "mixed";
    }>;
    basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type Motivation = z.infer<typeof MotivationSchema>;
export declare const PersonaKindSchema: z.ZodEnum<{
    interest: "interest";
    preference: "preference";
    view: "view";
    habit: "habit";
    relationship: "relationship";
    "value-application": "value-application";
}>;
export declare const ExperienceBasisSchema: z.ZodObject<{
    id: z.ZodUUID;
    sourceId: z.ZodUUID;
    taskEpoch: z.ZodNumber;
}, z.core.$strict>;
export declare const PersonaCandidateStateSchema: z.ZodEnum<{
    proposed: "proposed";
    held: "held";
    trial: "trial";
    adopted: "adopted";
    rejected: "rejected";
    withdrawn: "withdrawn";
    dormant: "dormant";
    superseded: "superseded";
}>;
export declare const PersonaEntryRefSchema: z.ZodObject<{
    id: z.ZodUUID;
    version: z.ZodNumber;
}, z.core.$strict>;
export type PersonaEntryRef = z.infer<typeof PersonaEntryRefSchema>;
export declare const PersonaProposalSchema: z.ZodObject<{
    requestId: z.ZodString;
    kind: z.ZodEnum<{
        interest: "interest";
        preference: "preference";
        view: "view";
        habit: "habit";
        relationship: "relationship";
        "value-application": "value-application";
    }>;
    contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    supports: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    counters: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>>;
    applicability: z.ZodString;
    reason: z.ZodString;
    experienceBasis: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        sourceId: z.ZodUUID;
        taskEpoch: z.ZodNumber;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const PersonaCandidateRevisionV1Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    agentId: z.ZodString;
    version: z.ZodNumber;
    state: z.ZodEnum<{
        proposed: "proposed";
        held: "held";
        trial: "trial";
        adopted: "adopted";
        rejected: "rejected";
        withdrawn: "withdrawn";
        dormant: "dormant";
        superseded: "superseded";
    }>;
    kind: z.ZodEnum<{
        interest: "interest";
        preference: "preference";
        view: "view";
        habit: "habit";
        relationship: "relationship";
        "value-application": "value-application";
    }>;
    contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    supports: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    counters: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    rootSources: z.ZodArray<z.ZodString>;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    motivation: z.ZodObject<{
        kind: z.ZodEnum<{
            unknown: "unknown";
            "explicit-task": "explicit-task";
            "self-exploration": "self-exploration";
            "conversation-invitation": "conversation-invitation";
            maintenance: "maintenance";
            mixed: "mixed";
        }>;
        basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    applicability: z.ZodString;
    reason: z.ZodString;
    runId: z.ZodUUID;
    producer: z.ZodString;
    createdAt: z.ZodISODateTime;
    policyVersion: z.ZodString;
    experienceBasis: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        sourceId: z.ZodUUID;
        taskEpoch: z.ZodNumber;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/** New writers use v2; the v1 branch exists only for byte-preserving historical reads. */
export declare const PersonaCandidateRevisionV2Schema: z.ZodObject<{
    id: z.ZodUUID;
    agentId: z.ZodString;
    version: z.ZodNumber;
    state: z.ZodEnum<{
        proposed: "proposed";
        held: "held";
        trial: "trial";
        adopted: "adopted";
        rejected: "rejected";
        withdrawn: "withdrawn";
        dormant: "dormant";
        superseded: "superseded";
    }>;
    kind: z.ZodEnum<{
        interest: "interest";
        preference: "preference";
        view: "view";
        habit: "habit";
        relationship: "relationship";
        "value-application": "value-application";
    }>;
    contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    supports: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    counters: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    rootSources: z.ZodArray<z.ZodString>;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    motivation: z.ZodObject<{
        kind: z.ZodEnum<{
            unknown: "unknown";
            "explicit-task": "explicit-task";
            "self-exploration": "self-exploration";
            "conversation-invitation": "conversation-invitation";
            maintenance: "maintenance";
            mixed: "mixed";
        }>;
        basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    applicability: z.ZodString;
    reason: z.ZodString;
    runId: z.ZodUUID;
    producer: z.ZodString;
    createdAt: z.ZodISODateTime;
    policyVersion: z.ZodString;
    experienceBasis: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        sourceId: z.ZodUUID;
        taskEpoch: z.ZodNumber;
    }, z.core.$strict>>>;
    schemaVersion: z.ZodLiteral<2>;
    maturity: z.ZodEnum<{
        tentative: "tentative";
        established: "established";
    }>;
    adoption: z.ZodNullable<z.ZodObject<{
        review: z.ZodObject<{
            id: z.ZodUUID;
            hash: z.ZodString;
        }, z.core.$strict>;
        decision: z.ZodObject<{
            id: z.ZodUUID;
            hash: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PersonaCandidateRevisionSchema: z.ZodUnion<readonly [z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    agentId: z.ZodString;
    version: z.ZodNumber;
    state: z.ZodEnum<{
        proposed: "proposed";
        held: "held";
        trial: "trial";
        adopted: "adopted";
        rejected: "rejected";
        withdrawn: "withdrawn";
        dormant: "dormant";
        superseded: "superseded";
    }>;
    kind: z.ZodEnum<{
        interest: "interest";
        preference: "preference";
        view: "view";
        habit: "habit";
        relationship: "relationship";
        "value-application": "value-application";
    }>;
    contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    supports: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    counters: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    rootSources: z.ZodArray<z.ZodString>;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    motivation: z.ZodObject<{
        kind: z.ZodEnum<{
            unknown: "unknown";
            "explicit-task": "explicit-task";
            "self-exploration": "self-exploration";
            "conversation-invitation": "conversation-invitation";
            maintenance: "maintenance";
            mixed: "mixed";
        }>;
        basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    applicability: z.ZodString;
    reason: z.ZodString;
    runId: z.ZodUUID;
    producer: z.ZodString;
    createdAt: z.ZodISODateTime;
    policyVersion: z.ZodString;
    experienceBasis: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        sourceId: z.ZodUUID;
        taskEpoch: z.ZodNumber;
    }, z.core.$strict>>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodUUID;
    agentId: z.ZodString;
    version: z.ZodNumber;
    state: z.ZodEnum<{
        proposed: "proposed";
        held: "held";
        trial: "trial";
        adopted: "adopted";
        rejected: "rejected";
        withdrawn: "withdrawn";
        dormant: "dormant";
        superseded: "superseded";
    }>;
    kind: z.ZodEnum<{
        interest: "interest";
        preference: "preference";
        view: "view";
        habit: "habit";
        relationship: "relationship";
        "value-application": "value-application";
    }>;
    contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    supports: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    counters: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    rootSources: z.ZodArray<z.ZodString>;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    motivation: z.ZodObject<{
        kind: z.ZodEnum<{
            unknown: "unknown";
            "explicit-task": "explicit-task";
            "self-exploration": "self-exploration";
            "conversation-invitation": "conversation-invitation";
            maintenance: "maintenance";
            mixed: "mixed";
        }>;
        basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    applicability: z.ZodString;
    reason: z.ZodString;
    runId: z.ZodUUID;
    producer: z.ZodString;
    createdAt: z.ZodISODateTime;
    policyVersion: z.ZodString;
    experienceBasis: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        sourceId: z.ZodUUID;
        taskEpoch: z.ZodNumber;
    }, z.core.$strict>>>;
    schemaVersion: z.ZodLiteral<2>;
    maturity: z.ZodEnum<{
        tentative: "tentative";
        established: "established";
    }>;
    adoption: z.ZodNullable<z.ZodObject<{
        review: z.ZodObject<{
            id: z.ZodUUID;
            hash: z.ZodString;
        }, z.core.$strict>;
        decision: z.ZodObject<{
            id: z.ZodUUID;
            hash: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>]>;
export type PersonaCandidateV1 = z.infer<typeof PersonaCandidateRevisionV1Schema>;
export type PersonaCandidateV2 = z.infer<typeof PersonaCandidateRevisionV2Schema>;
export type PersonaCandidate = z.infer<typeof PersonaCandidateRevisionSchema>;
export declare const PersonaStageSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    agentId: z.ZodString;
    revision: z.ZodNumber;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>>;
    createdAt: z.ZodISODateTime;
    policyVersion: z.ZodString;
}, z.core.$strict>;
export type PersonaStage = z.infer<typeof PersonaStageSchema>;
export declare const PersonaManifestV1Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    agentId: z.ZodString;
    runId: z.ZodUUID;
    foundationHash: z.ZodString;
    foundationIdentity: z.ZodString;
    stageRevision: z.ZodNumber;
    selectionVersion: z.ZodNumber;
    stageStatus: z.ZodEnum<{
        "not-configured": "not-configured";
        empty: "empty";
        selected: "selected";
        degraded: "degraded";
    }>;
    omittedCandidates: z.ZodOptional<z.ZodNumber>;
    entries: z.ZodArray<z.ZodObject<{
        candidate: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
    }, z.core.$strict>>;
    continuityCheckpointId: z.ZodNullable<z.ZodUUID>;
    policyVersion: z.ZodString;
    modelRouteHash: z.ZodString;
    assemblyVersion: z.ZodLiteral<"1">;
}, z.core.$strict>;
export declare const PersonaTrialSelectionRefSchema: z.ZodObject<{
    agentId: z.ZodString;
    scopeKey: z.ZodString;
    version: z.ZodNumber;
    hash: z.ZodString;
}, z.core.$strict>;
export type PersonaTrialSelectionRef = z.infer<typeof PersonaTrialSelectionRefSchema>;
export declare const PersonaTrialSelectionEntrySchema: z.ZodObject<{
    candidate: z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>;
    applicability: z.ZodString;
    exitConditions: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type PersonaTrialSelectionEntry = z.infer<typeof PersonaTrialSelectionEntrySchema>;
export declare const PersonaTrialSelectInputSchema: z.ZodObject<{
    requestId: z.ZodString;
    expectedSelectionVersion: z.ZodNumber;
    entries: z.ZodArray<z.ZodObject<{
        candidate: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        applicability: z.ZodString;
        exitConditions: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type PersonaTrialSelectInput = z.infer<typeof PersonaTrialSelectInputSchema>;
export declare const PersonaTrialSelectionSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    agentId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    version: z.ZodNumber;
    entries: z.ZodArray<z.ZodObject<{
        candidate: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        applicability: z.ZodString;
        exitConditions: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    runId: z.ZodUUID;
    producer: z.ZodString;
    createdAt: z.ZodISODateTime;
    policyVersion: z.ZodString;
}, z.core.$strict>;
export type PersonaTrialSelection = z.infer<typeof PersonaTrialSelectionSchema>;
export declare const PersonaTrialAdmissionEntrySchema: z.ZodObject<{
    candidate: z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>;
    selection: z.ZodObject<{
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>;
    contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    projectionHash: z.ZodString;
    sourceEvidence: z.ZodArray<z.ZodObject<{
        source: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        nature: z.ZodEnum<{
            unknown: "unknown";
            observed: "observed";
            synthetic: "synthetic";
            hypothetical: "hypothetical";
            "self-report": "self-report";
            derived: "derived";
        }>;
        coverage: z.ZodArray<z.ZodString>;
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
        roots: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            nature: z.ZodEnum<{
                unknown: "unknown";
                observed: "observed";
                synthetic: "synthetic";
                hypothetical: "hypothetical";
                "self-report": "self-report";
                derived: "derived";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type PersonaTrialAdmissionEntry = z.infer<typeof PersonaTrialAdmissionEntrySchema>;
/** Plain data alone carries no authority: core must authenticate the callback and input fingerprint. */
export declare const PersonaTrialAdmissionInputSchema: z.ZodObject<{
    entries: z.ZodArray<z.ZodObject<{
        candidate: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        selection: z.ZodObject<{
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            hash: z.ZodString;
        }, z.core.$strict>;
        contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
        projectionHash: z.ZodString;
        sourceEvidence: z.ZodArray<z.ZodObject<{
            source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"memory">;
                revision: z.ZodNumber;
                authorization: z.ZodOptional<z.ZodObject<{
                    taskId: z.ZodUUID;
                    taskEpoch: z.ZodNumber;
                    grantId: z.ZodUUID;
                    grantVersion: z.ZodNumber;
                    policyId: z.ZodString;
                    policyVersion: z.ZodNumber;
                }, z.core.$strict>>;
                selectionId: z.ZodOptional<z.ZodUUID>;
                range: z.ZodOptional<z.ZodObject<{
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                }, z.core.$strict>>;
                id: z.ZodUUID;
                agentId: z.ZodString;
                scopeKey: z.ZodString;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"execution-source">;
                id: z.ZodUUID;
                agentId: z.ZodString;
                scopeKey: z.ZodString;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>], "kind">;
            nature: z.ZodEnum<{
                unknown: "unknown";
                observed: "observed";
                synthetic: "synthetic";
                hypothetical: "hypothetical";
                "self-report": "self-report";
                derived: "derived";
            }>;
            coverage: z.ZodArray<z.ZodString>;
            completeness: z.ZodEnum<{
                unknown: "unknown";
                complete: "complete";
                partial: "partial";
            }>;
            roots: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                nature: z.ZodEnum<{
                    unknown: "unknown";
                    observed: "observed";
                    synthetic: "synthetic";
                    hypothetical: "hypothetical";
                    "self-report": "self-report";
                    derived: "derived";
                }>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    schemaVersion: z.ZodLiteral<1>;
    agentId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    runId: z.ZodUUID;
    manifestHash: z.ZodString;
    trialSelectionVersion: z.ZodNumber;
    admittedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type PersonaTrialAdmissionInput = z.infer<typeof PersonaTrialAdmissionInputSchema>;
export declare const PersonaTrialAdmissionSchema: z.ZodObject<{
    id: z.ZodUUID;
    policyVersion: z.ZodString;
    candidate: z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>;
    selection: z.ZodObject<{
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>;
    contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    projectionHash: z.ZodString;
    sourceEvidence: z.ZodArray<z.ZodObject<{
        source: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        nature: z.ZodEnum<{
            unknown: "unknown";
            observed: "observed";
            synthetic: "synthetic";
            hypothetical: "hypothetical";
            "self-report": "self-report";
            derived: "derived";
        }>;
        coverage: z.ZodArray<z.ZodString>;
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
        roots: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            nature: z.ZodEnum<{
                unknown: "unknown";
                observed: "observed";
                synthetic: "synthetic";
                hypothetical: "hypothetical";
                "self-report": "self-report";
                derived: "derived";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    schemaVersion: z.ZodLiteral<1>;
    agentId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    runId: z.ZodUUID;
    manifestHash: z.ZodString;
    trialSelectionVersion: z.ZodNumber;
    admittedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type PersonaTrialAdmission = z.infer<typeof PersonaTrialAdmissionSchema>;
export declare const PersonaTrialVisibleResultSchema: z.ZodObject<{
    sessionId: z.ZodString;
    messageSeq: z.ZodNumber;
    turnEndSeq: z.ZodNumber;
    textHash: z.ZodString;
}, z.core.$strict>;
export type PersonaTrialVisibleResult = z.infer<typeof PersonaTrialVisibleResultSchema>;
export declare const PersonaTrialTerminalSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    state: z.ZodLiteral<"completed">;
    result: z.ZodObject<{
        sessionId: z.ZodString;
        messageSeq: z.ZodNumber;
        turnEndSeq: z.ZodNumber;
        textHash: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodEnum<{
        failed: "failed";
        cancelled: "cancelled";
        interrupted: "interrupted";
    }>;
    result: z.ZodNull;
}, z.core.$strict>], "state">;
export type PersonaTrialTerminal = z.infer<typeof PersonaTrialTerminalSchema>;
export declare const PersonaTrialOperationSchema: z.ZodObject<{
    completeness: z.ZodEnum<{
        unknown: "unknown";
        complete: "complete";
        partial: "partial";
    }>;
    status: z.ZodEnum<{
        unknown: "unknown";
        partial: "partial";
        failed: "failed";
        cancelled: "cancelled";
        succeeded: "succeeded";
    }>;
    effects: z.ZodEnum<{
        unknown: "unknown";
        none: "none";
        confirmed: "confirmed";
    }>;
    id: z.ZodUUID;
    action: z.ZodString;
    outcomeHash: z.ZodString;
}, z.core.$strict>;
export type PersonaTrialOperation = z.infer<typeof PersonaTrialOperationSchema>;
/** A closed Run is an observed result, not proof of business success or permission to adopt. */
export declare const PersonaTrialCompletionInputSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    agentId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    runId: z.ZodUUID;
    terminal: z.ZodDiscriminatedUnion<[z.ZodObject<{
        state: z.ZodLiteral<"completed">;
        result: z.ZodObject<{
            sessionId: z.ZodString;
            messageSeq: z.ZodNumber;
            turnEndSeq: z.ZodNumber;
            textHash: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        state: z.ZodEnum<{
            failed: "failed";
            cancelled: "cancelled";
            interrupted: "interrupted";
        }>;
        result: z.ZodNull;
    }, z.core.$strict>], "state">;
    closedAt: z.ZodISODateTime;
    closedEventId: z.ZodUUID;
    operations: z.ZodArray<z.ZodObject<{
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
        status: z.ZodEnum<{
            unknown: "unknown";
            partial: "partial";
            failed: "failed";
            cancelled: "cancelled";
            succeeded: "succeeded";
        }>;
        effects: z.ZodEnum<{
            unknown: "unknown";
            none: "none";
            confirmed: "confirmed";
        }>;
        id: z.ZodUUID;
        action: z.ZodString;
        outcomeHash: z.ZodString;
    }, z.core.$strict>>;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    sourceEvidence: z.ZodArray<z.ZodObject<{
        source: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        nature: z.ZodEnum<{
            unknown: "unknown";
            observed: "observed";
            synthetic: "synthetic";
            hypothetical: "hypothetical";
            "self-report": "self-report";
            derived: "derived";
        }>;
        coverage: z.ZodArray<z.ZodString>;
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
        roots: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            nature: z.ZodEnum<{
                unknown: "unknown";
                observed: "observed";
                synthetic: "synthetic";
                hypothetical: "hypothetical";
                "self-report": "self-report";
                derived: "derived";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    gaps: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type PersonaTrialCompletionInput = z.infer<typeof PersonaTrialCompletionInputSchema>;
export declare const PersonaTrialOutcomeSchema: z.ZodObject<{
    id: z.ZodUUID;
    admission: z.ZodObject<{
        id: z.ZodUUID;
        hash: z.ZodString;
    }, z.core.$strict>;
    candidate: z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>;
    selection: z.ZodObject<{
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>;
    policyVersion: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    agentId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    runId: z.ZodUUID;
    terminal: z.ZodDiscriminatedUnion<[z.ZodObject<{
        state: z.ZodLiteral<"completed">;
        result: z.ZodObject<{
            sessionId: z.ZodString;
            messageSeq: z.ZodNumber;
            turnEndSeq: z.ZodNumber;
            textHash: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        state: z.ZodEnum<{
            failed: "failed";
            cancelled: "cancelled";
            interrupted: "interrupted";
        }>;
        result: z.ZodNull;
    }, z.core.$strict>], "state">;
    closedAt: z.ZodISODateTime;
    closedEventId: z.ZodUUID;
    operations: z.ZodArray<z.ZodObject<{
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
        status: z.ZodEnum<{
            unknown: "unknown";
            partial: "partial";
            failed: "failed";
            cancelled: "cancelled";
            succeeded: "succeeded";
        }>;
        effects: z.ZodEnum<{
            unknown: "unknown";
            none: "none";
            confirmed: "confirmed";
        }>;
        id: z.ZodUUID;
        action: z.ZodString;
        outcomeHash: z.ZodString;
    }, z.core.$strict>>;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    sourceEvidence: z.ZodArray<z.ZodObject<{
        source: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        nature: z.ZodEnum<{
            unknown: "unknown";
            observed: "observed";
            synthetic: "synthetic";
            hypothetical: "hypothetical";
            "self-report": "self-report";
            derived: "derived";
        }>;
        coverage: z.ZodArray<z.ZodString>;
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
        roots: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            nature: z.ZodEnum<{
                unknown: "unknown";
                observed: "observed";
                synthetic: "synthetic";
                hypothetical: "hypothetical";
                "self-report": "self-report";
                derived: "derived";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    gaps: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type PersonaTrialOutcome = z.infer<typeof PersonaTrialOutcomeSchema>;
export declare const PersonaCounterCheckSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"found">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodEnum<{
        unknown: "unknown";
        "not-obtained": "not-obtained";
    }>;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodLiteral<"checked-none">;
    checkedSources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    reason: z.ZodString;
}, z.core.$strict>], "status">;
export type PersonaCounterCheck = z.infer<typeof PersonaCounterCheckSchema>;
/** Model-facing source keys are resolved to exact references before a counter check is stored. */
export declare const PersonaCounterCheckInputSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"found">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodEnum<{
        unknown: "unknown";
        "not-obtained": "not-obtained";
    }>;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodLiteral<"checked-none">;
    checkedSources: z.ZodArray<z.ZodString>;
    reason: z.ZodString;
}, z.core.$strict>], "status">;
export type PersonaCounterCheckInput = z.infer<typeof PersonaCounterCheckInputSchema>;
export declare const PersonaAdoptionReviewInputSchema: z.ZodObject<{
    counterCheck: z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"found">;
        reason: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodEnum<{
            unknown: "unknown";
            "not-obtained": "not-obtained";
        }>;
        reason: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodLiteral<"checked-none">;
        checkedSources: z.ZodArray<z.ZodString>;
        reason: z.ZodString;
    }, z.core.$strict>], "status">;
    requestId: z.ZodString;
    supports: z.ZodArray<z.ZodString>;
    counters: z.ZodArray<z.ZodString>;
    candidate: z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>;
    trialOutcomes: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        hash: z.ZodString;
    }, z.core.$strict>>;
    conclusionScope: z.ZodString;
    targetMaturity: z.ZodEnum<{
        tentative: "tentative";
        established: "established";
    }>;
    limitations: z.ZodArray<z.ZodString>;
    reason: z.ZodString;
}, z.core.$strict>;
export type PersonaAdoptionReviewInput = z.infer<typeof PersonaAdoptionReviewInputSchema>;
export declare const PersonaAdoptionReviewSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    agentId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    runId: z.ZodUUID;
    producer: z.ZodString;
    createdAt: z.ZodISODateTime;
    policyVersion: z.ZodString;
    motivation: z.ZodObject<{
        kind: z.ZodEnum<{
            unknown: "unknown";
            "explicit-task": "explicit-task";
            "self-exploration": "self-exploration";
            "conversation-invitation": "conversation-invitation";
            maintenance: "maintenance";
            mixed: "mixed";
        }>;
        basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    supports: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    counters: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    sourceEvidence: z.ZodArray<z.ZodObject<{
        source: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        nature: z.ZodEnum<{
            unknown: "unknown";
            observed: "observed";
            synthetic: "synthetic";
            hypothetical: "hypothetical";
            "self-report": "self-report";
            derived: "derived";
        }>;
        coverage: z.ZodArray<z.ZodString>;
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
        roots: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            nature: z.ZodEnum<{
                unknown: "unknown";
                observed: "observed";
                synthetic: "synthetic";
                hypothetical: "hypothetical";
                "self-report": "self-report";
                derived: "derived";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    candidate: z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>;
    trialOutcomes: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        hash: z.ZodString;
    }, z.core.$strict>>;
    counterCheck: z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"found">;
        reason: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodEnum<{
            unknown: "unknown";
            "not-obtained": "not-obtained";
        }>;
        reason: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodLiteral<"checked-none">;
        checkedSources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
        reason: z.ZodString;
    }, z.core.$strict>], "status">;
    conclusionScope: z.ZodString;
    targetMaturity: z.ZodEnum<{
        tentative: "tentative";
        established: "established";
    }>;
    limitations: z.ZodArray<z.ZodString>;
    reason: z.ZodString;
}, z.core.$strict>;
export type PersonaAdoptionReview = z.infer<typeof PersonaAdoptionReviewSchema>;
export declare const PersonaAdoptionReasonCodeSchema: z.ZodEnum<{
    "trial-evidence-missing": "trial-evidence-missing";
    "trial-not-closed": "trial-not-closed";
    "trial-not-used": "trial-not-used";
    "source-stale": "source-stale";
    "scope-mismatch": "scope-mismatch";
    "candidate-stale": "candidate-stale";
    "counter-evidence-unresolved": "counter-evidence-unresolved";
    "coverage-insufficient": "coverage-insufficient";
    "motivation-mismatch": "motivation-mismatch";
    "maturity-unsupported": "maturity-unsupported";
    "review-required": "review-required";
}>;
export type PersonaAdoptionReasonCode = z.infer<typeof PersonaAdoptionReasonCodeSchema>;
export declare const PersonaAdoptionDecisionSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    review: z.ZodObject<{
        id: z.ZodUUID;
        hash: z.ZodString;
    }, z.core.$strict>;
    candidate: z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>;
    agentId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    policyVersion: z.ZodString;
    checkedAt: z.ZodISODateTime;
    eligibility: z.ZodEnum<{
        held: "held";
        allowed: "allowed";
    }>;
    reasons: z.ZodArray<z.ZodEnum<{
        "trial-evidence-missing": "trial-evidence-missing";
        "trial-not-closed": "trial-not-closed";
        "trial-not-used": "trial-not-used";
        "source-stale": "source-stale";
        "scope-mismatch": "scope-mismatch";
        "candidate-stale": "candidate-stale";
        "counter-evidence-unresolved": "counter-evidence-unresolved";
        "coverage-insufficient": "coverage-insufficient";
        "motivation-mismatch": "motivation-mismatch";
        "maturity-unsupported": "maturity-unsupported";
        "review-required": "review-required";
    }>>;
    dependencyHash: z.ZodString;
    stageRevision: z.ZodNumber;
    selectionVersion: z.ZodNumber;
    trialSelectionVersion: z.ZodNumber;
    targetMaturity: z.ZodEnum<{
        tentative: "tentative";
        established: "established";
    }>;
}, z.core.$strict>;
export type PersonaAdoptionDecision = z.infer<typeof PersonaAdoptionDecisionSchema>;
/** Optional review is legacy command compatibility only; a new successful write must require it. */
export declare const PersonaPublishInputSchema: z.ZodObject<{
    requestId: z.ZodString;
    expectedStageVersion: z.ZodNumber;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
        review: z.ZodOptional<z.ZodObject<{
            id: z.ZodUUID;
            hash: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type PersonaPublishInput = z.infer<typeof PersonaPublishInputSchema>;
export declare const PersonaManifestV2Schema: z.ZodObject<{
    agentId: z.ZodString;
    runId: z.ZodUUID;
    foundationHash: z.ZodString;
    foundationIdentity: z.ZodString;
    stageRevision: z.ZodNumber;
    selectionVersion: z.ZodNumber;
    stageStatus: z.ZodEnum<{
        "not-configured": "not-configured";
        empty: "empty";
        selected: "selected";
        degraded: "degraded";
    }>;
    omittedCandidates: z.ZodOptional<z.ZodNumber>;
    continuityCheckpointId: z.ZodNullable<z.ZodUUID>;
    policyVersion: z.ZodString;
    modelRouteHash: z.ZodString;
    schemaVersion: z.ZodLiteral<2>;
    assemblyVersion: z.ZodLiteral<"2">;
    entries: z.ZodArray<z.ZodObject<{
        candidate: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
        adoption: z.ZodDiscriminatedUnion<[z.ZodObject<{
            basis: z.ZodLiteral<"legacy-unclassified">;
            maturity: z.ZodLiteral<"legacy-unclassified">;
        }, z.core.$strict>, z.ZodObject<{
            basis: z.ZodLiteral<"reviewed">;
            maturity: z.ZodEnum<{
                tentative: "tentative";
                established: "established";
            }>;
            review: z.ZodObject<{
                id: z.ZodUUID;
                hash: z.ZodString;
            }, z.core.$strict>;
            decision: z.ZodObject<{
                id: z.ZodUUID;
                hash: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>], "basis">;
    }, z.core.$strict>>;
    trialSelectionVersion: z.ZodNumber;
    trialEntries: z.ZodArray<z.ZodObject<{
        projection: z.ZodLiteral<"trial">;
        maturity: z.ZodLiteral<"tentative">;
        candidate: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
        trialSelection: z.ZodObject<{
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            hash: z.ZodString;
        }, z.core.$strict>;
        projectionHash: z.ZodString;
    }, z.core.$strict>>;
    omittedTrials: z.ZodNumber;
}, z.core.$strict>;
export declare const PersonaManifestSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    agentId: z.ZodString;
    runId: z.ZodUUID;
    foundationHash: z.ZodString;
    foundationIdentity: z.ZodString;
    stageRevision: z.ZodNumber;
    selectionVersion: z.ZodNumber;
    stageStatus: z.ZodEnum<{
        "not-configured": "not-configured";
        empty: "empty";
        selected: "selected";
        degraded: "degraded";
    }>;
    omittedCandidates: z.ZodOptional<z.ZodNumber>;
    entries: z.ZodArray<z.ZodObject<{
        candidate: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
    }, z.core.$strict>>;
    continuityCheckpointId: z.ZodNullable<z.ZodUUID>;
    policyVersion: z.ZodString;
    modelRouteHash: z.ZodString;
    assemblyVersion: z.ZodLiteral<"1">;
}, z.core.$strict>, z.ZodObject<{
    agentId: z.ZodString;
    runId: z.ZodUUID;
    foundationHash: z.ZodString;
    foundationIdentity: z.ZodString;
    stageRevision: z.ZodNumber;
    selectionVersion: z.ZodNumber;
    stageStatus: z.ZodEnum<{
        "not-configured": "not-configured";
        empty: "empty";
        selected: "selected";
        degraded: "degraded";
    }>;
    omittedCandidates: z.ZodOptional<z.ZodNumber>;
    continuityCheckpointId: z.ZodNullable<z.ZodUUID>;
    policyVersion: z.ZodString;
    modelRouteHash: z.ZodString;
    schemaVersion: z.ZodLiteral<2>;
    assemblyVersion: z.ZodLiteral<"2">;
    entries: z.ZodArray<z.ZodObject<{
        candidate: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
        adoption: z.ZodDiscriminatedUnion<[z.ZodObject<{
            basis: z.ZodLiteral<"legacy-unclassified">;
            maturity: z.ZodLiteral<"legacy-unclassified">;
        }, z.core.$strict>, z.ZodObject<{
            basis: z.ZodLiteral<"reviewed">;
            maturity: z.ZodEnum<{
                tentative: "tentative";
                established: "established";
            }>;
            review: z.ZodObject<{
                id: z.ZodUUID;
                hash: z.ZodString;
            }, z.core.$strict>;
            decision: z.ZodObject<{
                id: z.ZodUUID;
                hash: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>], "basis">;
    }, z.core.$strict>>;
    trialSelectionVersion: z.ZodNumber;
    trialEntries: z.ZodArray<z.ZodObject<{
        projection: z.ZodLiteral<"trial">;
        maturity: z.ZodLiteral<"tentative">;
        candidate: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
        trialSelection: z.ZodObject<{
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            hash: z.ZodString;
        }, z.core.$strict>;
        projectionHash: z.ZodString;
    }, z.core.$strict>>;
    omittedTrials: z.ZodNumber;
}, z.core.$strict>], "schemaVersion">;
export type PersonaManifestV1 = z.infer<typeof PersonaManifestV1Schema>;
export type PersonaManifestV2 = z.infer<typeof PersonaManifestV2Schema>;
export type PersonaManifest = z.infer<typeof PersonaManifestSchema>;
export declare const ContinuityCheckpointSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    agentId: z.ZodString;
    runId: z.ZodUUID;
    taskId: z.ZodUUID;
    taskEpoch: z.ZodNumber;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    foundationHash: z.ZodString;
    stageRevision: z.ZodNumber;
    sessionId: z.ZodString;
    throughSeq: z.ZodNumber;
    dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    completedOperations: z.ZodArray<z.ZodUUID>;
    unknownOperations: z.ZodArray<z.ZodUUID>;
    historyHash: z.ZodOptional<z.ZodString>;
    intentEvents: z.ZodOptional<z.ZodArray<z.ZodUUID>>;
    summary: z.ZodString;
    gaps: z.ZodArray<z.ZodString>;
    createdAt: z.ZodISODateTime;
}, z.core.$strict>;
export type ContinuityCheckpoint = z.infer<typeof ContinuityCheckpointSchema>;
export declare const TaskIntentEventSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    agentId: z.ZodString;
    taskId: z.ZodUUID;
    taskEpoch: z.ZodNumber;
    runId: z.ZodUUID;
    requestId: z.ZodString;
    producer: z.ZodString;
    kind: z.ZodEnum<{
        accepted: "accepted";
        objection: "objection";
        resolved: "resolved";
    }>;
    motivation: z.ZodObject<{
        kind: z.ZodEnum<{
            unknown: "unknown";
            "explicit-task": "explicit-task";
            "self-exploration": "self-exploration";
            "conversation-invitation": "conversation-invitation";
            maintenance: "maintenance";
            mixed: "mixed";
        }>;
        basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    category: z.ZodEnum<{
        preference: "preference";
        scope: "scope";
        none: "none";
        method: "method";
        premise: "premise";
        "missing-information": "missing-information";
    }>;
    blocking: z.ZodBoolean;
    reason: z.ZodString;
    actions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    historyHash: z.ZodOptional<z.ZodString>;
    evidence: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    resolves: z.ZodNullable<z.ZodUUID>;
    createdAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TaskIntentEvent = z.infer<typeof TaskIntentEventSchema>;
/** Native service access is issued by core; serializing this value conveys no authority. */
export interface PersonaAccess {
    readonly view: ExecutionView;
    readonly producer: string;
    readonly operationId: string;
    readonly startedEventId: string | null;
    readonly intentVersion: number;
    readonly motivation: Motivation;
    readonly inputs: readonly ExecutionInput[];
    readonly admittedSources: readonly PersonaSourceRef[];
    readonly guard: () => void;
    readonly commitGuard?: () => void;
    readonly sourceRules?: readonly string[];
    readonly historyDependencies?: readonly SourceDependency[];
    readonly historyTracked?: boolean;
    readonly validateHistory?: (dependencies: readonly SourceDependency[]) => boolean;
    readonly operationFinished?: (id: string) => boolean;
    readonly verifyMemorySource?: (ref: PersonaSourceRef) => {
        text: string;
        rootSources: readonly string[];
    } | null;
    readonly resourceAllowed?: (scene: import('./conversation.js').Conversation) => boolean;
}
export interface PreparedPersonaEntry {
    readonly candidate: z.infer<typeof PersonaEntryRefSchema>;
    readonly contentRef: PersonaSourceRef;
    readonly dependencies: readonly PersonaSourceRef[];
    readonly item: ContextItem;
    readonly adoption?: PersonaAdoptionClassification;
}
export interface PreparedPersonaTrialEntry {
    readonly projection: 'trial';
    readonly maturity: 'tentative';
    readonly trialSelection: PersonaTrialSelectionRef;
    readonly candidate: PersonaEntryRef;
    readonly contentRef: PersonaSourceRef;
    readonly dependencies: readonly PersonaSourceRef[];
    readonly item: ContextItem;
    readonly exitConditions: readonly string[];
    readonly sourceEvidence: readonly PersonaSourceEvidence[];
}
export interface PreparedPersona {
    readonly stageRevision: number;
    readonly selectionVersion: number;
    readonly entries: readonly PreparedPersonaEntry[];
    readonly omitted: number;
    readonly trialEntries?: readonly PreparedPersonaTrialEntry[];
    readonly trialSelectionVersion?: number;
    readonly omittedTrials?: number;
}
/** Core authenticates this live callback object and the exact plain input before memory may use it. */
export interface PersonaTrialAuthority {
    readonly guard: () => void;
}
/** Memory & Growth owns mutable personality, preferences and relationships.
 * Core consumes scoped projections and reports actual use; it owns no second state store. */
export interface MemoryGrowthProvider {
    ready(): boolean;
    prepare(access: PersonaAccess): PreparedPersona;
    validate(access: PersonaAccess, entry: PreparedPersonaEntry): boolean;
    validateHistoricalTrial?(access: PersonaAccess, dependency: Extract<SourceDependency, {
        kind: 'context';
    }>): boolean;
    trialAdmitted?(input: PersonaTrialAdmissionInput, authority: PersonaTrialAuthority): readonly PersonaTrialAdmissionRef[];
    completeTrial?(input: PersonaTrialCompletionInput, authority: PersonaTrialAuthority): readonly PersonaTrialOutcomeRef[];
}
/** @deprecated Use MemoryGrowthProvider. Kept for existing extensions. */
export type PersonaProvider = MemoryGrowthProvider;
