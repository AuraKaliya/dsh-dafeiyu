import { BoundedProcess } from './process.js';
import { MediaRangeBroker } from './range-broker.js';
export type DecoderInput = {
    file: string;
} | {
    broker: MediaRangeBroker;
};
export interface DecodedImage {
    data: Buffer;
    mime: 'image/png' | 'image/jpeg';
    width: number;
    height: number;
    hasAlpha: boolean;
    requestedMs: number | null;
    ptsMs: number | null;
}
export declare class MediaDecoder {
    private readonly process;
    private readonly allowedRoot;
    readonly tools: {
        ffmpeg: string;
        ffprobe: string;
    };
    readonly limits: {
        maxPixels: number;
        maxDimension: number;
        maxAudioMs: number;
        memoryBytes: number;
        timeoutMs: number;
    };
    constructor(process: BoundedProcess, allowedRoot: string, tools: {
        ffmpeg: string;
        ffprobe: string;
    }, limits?: {
        maxPixels: number;
        maxDimension: number;
        maxAudioMs: number;
        memoryBytes: number;
        timeoutMs: number;
    });
    private input;
    private run;
    inspect(input: DecoderInput, signal: AbortSignal): Promise<{
        kind: "unknown" | "image" | "audio" | "video";
        width: number | null;
        height: number | null;
        durationMs: number | null;
        startMs: number;
        videoCodec: string | null;
        audioCodec: string | null;
        sampleRate: number | null;
        channels: number | null;
        format: string;
        peakCommitBytes: number;
    }>;
    private png;
    private inputOptions;
    image(input: DecoderInput, signal: AbortSignal, pointMs?: number): Promise<DecodedImage>;
    audio(input: DecoderInput, startMs: number, endMs: number, signal: AbortSignal): Promise<{
        data: Buffer<ArrayBuffer>;
        mime: "audio/wav";
        sampleRate: number;
        channels: number;
        samples: number;
        startMs: number;
        endMs: number;
        requestedEndMs: number;
        sourceDurationMs: number | null;
        completeness: "complete" | "partial";
        peakCommitBytes: number;
    }>;
}
