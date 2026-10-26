export declare function subtitleTracks(raw: unknown): {
    id: string;
    language: string;
    label: string;
    automatic: boolean | null;
    url: string;
}[];
export declare function subtitleText(raw: unknown, startMs: number, endMs: number, offset: number, limit: number): {
    entries: {
        startMs: number;
        endMs: number;
        text: string;
    }[];
    received: number;
    nextOffset: number | null;
    range: {
        startMs: number;
        endMs: number;
    };
    coverage: string[];
};
export declare function danmakuText(bytes: Uint8Array, startMs: number, endMs: number, offset: number, limit: number): {
    items: {
        id: string;
        atMs: number;
        mode: number;
        text: string;
    }[];
    received: number;
    matching: number;
    nextOffset: number | null;
    range: {
        startMs: number;
        endMs: number;
    };
    coverage: string[];
};
