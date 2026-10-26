import type { AudioWorker } from './audio.js';
/** Program-only backend. Delivery authority must bind the approved final text before calling it. */
export declare class SystemSpeech {
    private readonly root;
    private readonly settings;
    private readonly worker;
    constructor(root: string, settings: {
        powershell: string;
        voice: string;
    }, worker?: AudioWorker);
    synthesize(approved: {
        text: string;
        textHash: string;
        guard: () => void;
    }, signal: AbortSignal): Promise<{
        samples: number;
        durationMs: number;
        sha256: string;
        data: Buffer<ArrayBuffer>;
        mime: "audio/wav";
        textHash: string;
        voice: string;
    }>;
}
