/** A forwarded copy is evidence, never an authenticated speaker or a command. No recursive network expansion. */
export declare function recentForwardNodes(raw: unknown, now?: number): {
    observedAt: string;
    since: string;
    messages: {
        index: number;
        occurredAt: string;
        displayName: string;
        text: string;
        truncated: boolean;
        parts: {
            type: string;
            data: Record<string, unknown>;
        }[];
    }[];
    excluded: number;
    limited: boolean;
    coverage: string;
};
export declare function forwardHandles(parts: readonly {
    type: string;
    data: Record<string, unknown>;
}[]): string[];
