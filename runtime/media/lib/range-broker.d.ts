import type { MediaByteStream } from '#dafeiyu/contracts';
export declare class MediaRangeBroker {
    readonly bytes: number;
    private readonly maximum;
    private readonly read;
    private readonly guard;
    private readonly caller;
    private readonly token;
    private readonly abort;
    private readonly server;
    private addressValue;
    private transferred;
    private readonly ranges;
    private readonly pending;
    private constructor();
    static open(options: {
        bytes: number;
        maxBytes: number;
        read: (range: {
            start: number;
            end: number;
        }, signal: AbortSignal) => Promise<MediaByteStream>;
        guard: () => void;
        signal: AbortSignal;
    }): Promise<MediaRangeBroker>;
    url(): string;
    get coverage(): {
        transferredBytes: number;
        ranges: {
            start: number;
            end: number;
            sha256: string;
        }[];
    };
    close(): Promise<void>;
}
