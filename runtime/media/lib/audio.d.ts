import { z } from 'zod';
import type { WorkerSpec, WorkerResult } from './process.js';
export declare const audioConfigSchema: z.ZodObject<{
    whisper: z.ZodOptional<z.ZodObject<{
        node: z.ZodString;
        moduleDirectory: z.ZodString;
        moduleVersion: z.ZodLiteral<"1.1.3">;
        model: z.ZodObject<{
            path: z.ZodString;
            sha256: z.ZodString;
        }, z.core.$strict>;
        language: z.ZodDefault<z.ZodString>;
        memoryBytes: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    events: z.ZodOptional<z.ZodObject<{
        python: z.ZodString;
        model: z.ZodObject<{
            path: z.ZodString;
            sha256: z.ZodString;
        }, z.core.$strict>;
        labels: z.ZodObject<{
            path: z.ZodString;
            sha256: z.ZodString;
        }, z.core.$strict>;
        onnxruntimeVersion: z.ZodString;
        numpyVersion: z.ZodString;
        memoryBytes: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type AudioConfig = z.output<typeof audioConfigSchema>;
export interface PcmAudio {
    data: Buffer;
    samples: number;
    startMs: number;
    endMs: number;
    requestedEndMs: number;
    completeness: 'complete' | 'partial';
}
declare const segment: z.ZodObject<{
    startMs: z.ZodNumber;
    endMs: z.ZodNumber;
    text: z.ZodString;
}, z.core.$strict>;
declare const eventSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    kind: z.ZodLiteral<"events">;
    inputSha256: z.ZodString;
    samples: z.ZodNumber;
    backend: z.ZodLiteral<"yamnet-onnx">;
    modelSha256: z.ZodString;
    labelsSha256: z.ZodString;
    onnxruntimeVersion: z.ZodString;
    numpyVersion: z.ZodString;
    windows: z.ZodArray<z.ZodObject<{
        startMs: z.ZodNumber;
        endMs: z.ZodNumber;
        scores: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            score: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export interface AudioWorker {
    run(spec: WorkerSpec): Promise<WorkerResult>;
}
export declare function pcmInfo(data: Buffer): {
    samples: number;
    durationMs: number;
    sha256: string;
};
/** Fixed local backends, executed through the same bounded process boundary as FFmpeg. */
export declare class AudioPipeline {
    private readonly root;
    private readonly config;
    private readonly worker;
    private readonly timeoutMs;
    constructor(root: string, config: AudioConfig, worker?: AudioWorker, timeoutMs?: number);
    private pinned;
    read(audio: PcmAudio, signal: AbortSignal, guard: () => void): Promise<{
        kind: "actual-audio-processing";
        pcmSha256: string;
        samples: number;
        startMs: number;
        endMs: number;
        requestedEndMs: number;
        asr: {
            status: "complete";
            segments: z.infer<typeof segment>[];
            backend: string;
            version: string;
            modelSha256: string;
        } | {
            status: "unavailable" | "failed";
            code: string;
        };
        events: {
            status: "complete";
            windows: z.infer<typeof eventSchema>["windows"];
            backend: string;
            modelSha256: string;
            labelsSha256: string;
            onnxruntimeVersion: string;
            numpyVersion: string;
        } | {
            status: "unavailable" | "failed";
            code: string;
        };
        speechDetected: boolean;
        scoreMeaning: string;
        gaps: string[];
        technicalCompleteness: "complete" | "partial";
    }>;
}
export {};
