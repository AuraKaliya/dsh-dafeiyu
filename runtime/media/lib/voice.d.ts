import { z } from 'zod';
import type { MediaExposure } from './store.js';
import type { MediaStore } from './store.js';
/** This derives a witness from persisted processing, never from model-authored transcript text. */
export declare function voiceWitness(store: MediaStore, exposure: MediaExposure): {
    text: string;
    evidence: {
        schemaVersion: 1;
        exposure: {
            provider: string;
            scene: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
                id: string;
            };
            key: string;
            version: number;
            hash: string;
            roots: string[];
            detail: z.core.util.JSONType;
        };
        origin: {
            provider: string;
            scene: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
                id: string;
            };
            key: string;
            version: number;
            hash: string;
            roots: string[];
            detail: z.core.util.JSONType;
        };
        source: {
            provider: string;
            key: string;
        };
        audioAsset: {
            schemaVersion: 1;
            id: string;
            version: number;
            kind: "image" | "audio" | "video" | "document";
            sha256: string;
            bytes: number;
            mime: string;
        };
        pcm: {
            schemaVersion: 1;
            id: string;
            version: number;
            kind: "image" | "audio" | "video" | "document";
            sha256: string;
            bytes: number;
            mime: string;
        };
        observation: {
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
        transcriptHash: string;
        sourceDurationMs: number;
        asr: {
            backend: "whisper.node";
            version: "1.1.3";
            modelSha256: string;
        };
        events: {
            backend: "yamnet-onnx";
            modelSha256: string;
            labelsSha256: string;
            onnxruntimeVersion: string;
            numpyVersion: string;
        };
    };
};
