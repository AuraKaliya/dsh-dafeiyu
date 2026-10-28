import type { ContextItem, ContextStage, ContextBudget } from '#dafeiyu/contracts';
import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
export declare const contextBytes: (value: unknown) => number;
export interface ContextGroup {
    readonly owner: string;
    readonly region: string;
    readonly kind: string;
    readonly items: readonly ContextItem[];
    readonly required: boolean;
    readonly priority: number;
    readonly maxBytes: number;
    readonly unavailable?: boolean;
    validate(item: ContextItem): boolean;
}
export interface AdmittedRegion {
    owner: string;
    region: string;
    kind: string;
    items: ContextItem[];
}
export type AdmissionDecision = {
    owner: string;
    region: string;
    available: number;
    selected: number;
    invalid: number;
    overBudget: number;
    unavailable: boolean;
    maxBytes: number;
    priority: number;
    required: boolean;
};
export interface ContextPacket {
    text: string;
    regions: AdmittedRegion[];
    decisions: AdmissionDecision[];
}
export declare const renderControlledContext: (regions: readonly AdmittedRegion[]) => string;
/** Admission is shared by all stages. Required is supplied by Core, never by model arguments. */
export declare function admitContext(groups: readonly ContextGroup[], maxBytes: number, render?: (regions: readonly AdmittedRegion[]) => string): ContextPacket;
/** Metadata only: material bodies stay in their existing source stores. */
export declare function contextManifest(stage: ContextStage, packet: ContextPacket): {
    schemaVersion: number;
    stage: "assessment" | "verification" | "feedback" | "conversation" | "delivery" | "exploration" | "recovery";
    bytes: number;
    decisions: AdmissionDecision[];
    selected: {
        owner: string;
        region: string;
        id: string;
        version: string;
        sources: {
            ref: string;
            version: string;
            hash: string;
        }[];
    }[];
};
export declare function admitNativeContexts(material: readonly {
    owner: string;
    region: string;
    item: ContextItem;
}[], maxBytes: number, policies?: ContextBudget['regions']): {
    packet: ContextPacket;
    contexts: {
        owner: string;
        region: string;
        item: {
            id: string;
            version: string;
            text: string;
            sources: {
                ref: string;
                version: string;
                hash: string;
            }[];
            expiresAt: string;
        };
    }[];
};
export declare function requestCapacity(request: {
    messages: unknown;
    tools?: unknown;
    toolHistory?: unknown;
}, maximum: number, reserve: number): {
    bytes: number;
    reserveBytes: number;
    maximumBytes: number;
    categories: {
        messages: number;
        tools: number;
        toolHistory: number;
    };
    withinBudget: boolean;
    measurement: "utf8-serialized-bytes";
};
export declare function inspectRequestCapacity(ctx: Context, options: GenerateOptions, maximum: number, reserve: number, known?: LlmResolvedModelInfo): Promise<{
    messageBreakdown: {
        system: number;
        currentInput: number;
        history: number;
        toolResults: number;
        runtimeContext: number;
        mediaBlocks: number;
    };
    estimatedInputTokens: number;
    tokenMeasurement: string;
    modelContextWindow: number | null;
    reservedOutputTokens: number | null;
    estimateOnly: boolean;
    modelLimitsKnown: boolean;
    bytes: number;
    reserveBytes: number;
    maximumBytes: number;
    categories: {
        messages: number;
        tools: number;
        toolHistory: number;
    };
    withinBudget: boolean;
    measurement: "utf8-serialized-bytes";
}>;
export declare function prepareWithin<T>(work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, remainingMs: number): Promise<T>;
