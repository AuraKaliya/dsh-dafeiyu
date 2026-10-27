import { z } from 'zod';
import type { InboundMessage } from './index.js';
import type { MediaVoiceEvidence } from './media.js';
import type { ExecutionContextV3 } from './execution.js';
import type { Conversation } from './conversation.js';
export declare const MessageTaskSubmitSchema: z.ZodObject<{
    requestId: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    kind: z.ZodDefault<z.ZodEnum<{
        "explicit-task": "explicit-task";
        "self-exploration": "self-exploration";
    }>>;
    goal: z.ZodOptional<z.ZodString>;
    voiceExposureId: z.ZodOptional<z.ZodUUID>;
}, z.core.$strict>;
export declare const MessageInstructionSubmitSchema: z.ZodObject<{
    requestId: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodLiteral<"explicit-task">>;
    voiceExposureId: z.ZodOptional<z.ZodUUID>;
}, z.core.$strict>;
export declare const MessageExplorationSubmitSchema: z.ZodObject<{
    requestId: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    goal: z.ZodString;
}, z.core.$strict>;
export declare const MessageTaskStatusSchema: z.ZodObject<{
    taskId: z.ZodUUID;
}, z.core.$strict>;
export declare const MessageTaskControlSchema: z.ZodObject<{
    requestId: z.ZodString;
    taskId: z.ZodUUID;
    expectedVersion: z.ZodNumber;
    action: z.ZodEnum<{
        cancel: "cancel";
        revise: "revise";
        resolve: "resolve";
        resume: "resume";
    }>;
    objectionId: z.ZodOptional<z.ZodUUID>;
    voiceExposureId: z.ZodOptional<z.ZodUUID>;
}, z.core.$strict>;
export declare const MessageTaskSourceSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    bindingId: z.ZodString;
    authorityVersion: z.ZodString;
    inboundId: z.ZodUUID;
    messageHash: z.ZodString;
    conversation: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
    kind: z.ZodEnum<{
        "explicit-task": "explicit-task";
        "self-exploration": "self-exploration";
    }>;
    resources: z.ZodArray<z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>>;
    voice: z.ZodOptional<z.ZodObject<{
        bindingVersion: z.ZodString;
        evidence: z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            exposure: z.ZodObject<{
                provider: z.ZodString;
                scene: z.ZodObject<{
                    channel: z.ZodString;
                    account: z.ZodString;
                    kind: z.ZodEnum<{
                        private: "private";
                        group: "group";
                        local: "local";
                    }>;
                    id: z.ZodString;
                }, z.core.$strict>;
                key: z.ZodString;
                version: z.ZodNumber;
                hash: z.ZodString;
                roots: z.ZodArray<z.ZodString>;
                detail: z.ZodJSONSchema;
            }, z.core.$strict>;
            origin: z.ZodObject<{
                provider: z.ZodString;
                scene: z.ZodObject<{
                    channel: z.ZodString;
                    account: z.ZodString;
                    kind: z.ZodEnum<{
                        private: "private";
                        group: "group";
                        local: "local";
                    }>;
                    id: z.ZodString;
                }, z.core.$strict>;
                key: z.ZodString;
                version: z.ZodNumber;
                hash: z.ZodString;
                roots: z.ZodArray<z.ZodString>;
                detail: z.ZodJSONSchema;
            }, z.core.$strict>;
            source: z.ZodObject<{
                provider: z.ZodString;
                key: z.ZodString;
            }, z.core.$strict>;
            audioAsset: z.ZodObject<{
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
            pcm: z.ZodObject<{
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
            observation: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
            transcriptHash: z.ZodString;
            sourceDurationMs: z.ZodNumber;
            asr: z.ZodObject<{
                backend: z.ZodLiteral<"whisper.node">;
                version: z.ZodLiteral<"1.1.3">;
                modelSha256: z.ZodString;
            }, z.core.$strict>;
            events: z.ZodObject<{
                backend: z.ZodLiteral<"yamnet-onnx">;
                modelSha256: z.ZodString;
                labelsSha256: z.ZodString;
                onnxruntimeVersion: z.ZodString;
                numpyVersion: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    control: z.ZodOptional<z.ZodObject<{
        inboundId: z.ZodUUID;
        messageHash: z.ZodString;
        voice: z.ZodOptional<z.ZodObject<{
            bindingVersion: z.ZodString;
            evidence: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                exposure: z.ZodObject<{
                    provider: z.ZodString;
                    scene: z.ZodObject<{
                        channel: z.ZodString;
                        account: z.ZodString;
                        kind: z.ZodEnum<{
                            private: "private";
                            group: "group";
                            local: "local";
                        }>;
                        id: z.ZodString;
                    }, z.core.$strict>;
                    key: z.ZodString;
                    version: z.ZodNumber;
                    hash: z.ZodString;
                    roots: z.ZodArray<z.ZodString>;
                    detail: z.ZodJSONSchema;
                }, z.core.$strict>;
                origin: z.ZodObject<{
                    provider: z.ZodString;
                    scene: z.ZodObject<{
                        channel: z.ZodString;
                        account: z.ZodString;
                        kind: z.ZodEnum<{
                            private: "private";
                            group: "group";
                            local: "local";
                        }>;
                        id: z.ZodString;
                    }, z.core.$strict>;
                    key: z.ZodString;
                    version: z.ZodNumber;
                    hash: z.ZodString;
                    roots: z.ZodArray<z.ZodString>;
                    detail: z.ZodJSONSchema;
                }, z.core.$strict>;
                source: z.ZodObject<{
                    provider: z.ZodString;
                    key: z.ZodString;
                }, z.core.$strict>;
                audioAsset: z.ZodObject<{
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
                pcm: z.ZodObject<{
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
                observation: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                transcriptHash: z.ZodString;
                sourceDurationMs: z.ZodNumber;
                asr: z.ZodObject<{
                    backend: z.ZodLiteral<"whisper.node">;
                    version: z.ZodLiteral<"1.1.3">;
                    modelSha256: z.ZodString;
                }, z.core.$strict>;
                events: z.ZodObject<{
                    backend: z.ZodLiteral<"yamnet-onnx">;
                    modelSha256: z.ZodString;
                    labelsSha256: z.ZodString;
                    onnxruntimeVersion: z.ZodString;
                    numpyVersion: z.ZodString;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type MessageTaskSource = z.infer<typeof MessageTaskSourceSchema>;
/** Program-owned registration, never model parameters. The classifier sees only the real main body. */
export interface MessageTaskBinding {
    id: string;
    pluginId: string;
    channelExtensionId: string;
    channel: string;
    account: string;
    ownerId: string;
    policyId: string;
    version: string;
    explorationResources?: readonly Conversation[];
    expressionPolicy?: {
        id: string;
        version: number;
    };
    autoDeliver?: boolean;
    voice?: {
        version: string;
        resolve(context: ExecutionContextV3, message: InboundMessage, exposureId: string): {
            text: string;
            evidence: MediaVoiceEvidence;
        };
        current(message: InboundMessage, evidence: MediaVoiceEvidence): boolean;
    };
    classify(message: InboundMessage): {
        kind: 'submit' | 'cancel' | 'revise' | 'resolve' | 'none';
        text: string;
    };
    active(): boolean;
}
