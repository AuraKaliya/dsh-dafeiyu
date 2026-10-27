import { z } from 'zod';
import type { PersonaAccess } from './persona.js';
import type { NativeMediaMaterial } from './media.js';
export declare const TaskResultAnchorSchema: z.ZodObject<{
    kind: z.ZodLiteral<"task-result">;
    schemaVersion: z.ZodLiteral<1>;
    taskId: z.ZodUUID;
    runId: z.ZodUUID;
    inboundId: z.ZodUUID;
    target: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
    intentVersion: z.ZodNumber;
    authorityVersion: z.ZodString;
    expiresAt: z.ZodISODateTime;
    outcome: z.ZodOptional<z.ZodLiteral<"waiting">>;
}, z.core.$strict>;
export type TaskResultAnchor = z.infer<typeof TaskResultAnchorSchema>;
export declare const NativeExpressionCandidateSchema: z.ZodObject<{
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
    view: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const NativeExpressionPacketSchema: z.ZodObject<{
    id: z.ZodUUID;
    version: z.ZodNumber;
    anchor: z.ZodObject<{
        kind: z.ZodLiteral<"task-result">;
        schemaVersion: z.ZodLiteral<1>;
        taskId: z.ZodUUID;
        runId: z.ZodUUID;
        inboundId: z.ZodUUID;
        target: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        intentVersion: z.ZodNumber;
        authorityVersion: z.ZodString;
        expiresAt: z.ZodISODateTime;
        outcome: z.ZodOptional<z.ZodLiteral<"waiting">>;
    }, z.core.$strict>;
    question: z.ZodString;
    evidence: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            reported: "reported";
            inference: "inference";
        }>;
        text: z.ZodString;
    }, z.core.$strict>>;
    sourceStamp: z.ZodString;
    resultIncluded: z.ZodBoolean;
    media: z.ZodOptional<z.ZodObject<{
        draftId: z.ZodUUID;
        draftVersion: z.ZodNumber;
        sourceStamp: z.ZodString;
        parts: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"asset">;
            delivery: z.ZodEnum<{
                image: "image";
                record: "record";
                file: "file";
            }>;
            asset: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                id: z.ZodUUID;
                version: z.ZodNumber;
                kind: z.ZodEnum<{
                    image: "image";
                    audio: "audio";
                    video: "video";
                    document: "document";
                }>;
                sha256: z.ZodString;
                bytes: z.ZodNumber;
                mime: z.ZodString;
            }, z.core.$strict>;
            name: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"final-voice">;
        }, z.core.$strict>], "kind">>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type NativeExpressionPacket = z.infer<typeof NativeExpressionPacketSchema>;
/** Created by the core from persisted, verified native execution facts, never model-supplied. */
export interface NativeExpressionAccess {
    readonly execution: PersonaAccess;
    readonly anchor: TaskResultAnchor;
    readonly question: string;
    readonly output: string;
    readonly candidates: readonly z.infer<typeof NativeExpressionCandidateSchema>[];
    readonly opaqueInfluence: boolean;
    /** Only the Core source walk can attest that a derived target page has no unclassified input influence. */
    readonly derivedInputComplete?: boolean;
    readonly requestMaxBytes: number;
    readonly expressionPolicy?: {
        id: string;
        version: number;
    };
    readonly media?: NativeMediaMaterial;
    guard(): void;
}
export interface NativeExpressionPort {
    readonly signal?: AbortSignal;
    ready(): boolean;
    prepare(access: NativeExpressionAccess): NativeExpressionPacket;
    open(access: NativeExpressionAccess, id: string, purpose?: 'send' | 'context'): NativeExpressionPacket;
    withdraw(access: NativeExpressionAccess, id: string, version: number): void;
    verify(access: NativeExpressionAccess, id: string, answer: string, signal: AbortSignal, guard: () => void): Promise<void>;
}
