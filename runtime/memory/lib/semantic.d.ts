import type { Context } from '@deepseek-ai/cordis';
import type { SemanticRequest, SemanticResult } from '#dafeiyu/contracts';
export declare class SemanticVerificationError extends Error {
    readonly verification: {
        compatible: boolean;
        faithful: boolean;
        issues: string[];
    };
    readonly code = "SEMANTIC_VERIFICATION_REJECTED";
    constructor(verification: {
        compatible: boolean;
        faithful: boolean;
        issues: string[];
    });
}
export declare class SemanticSourceCapacityError extends Error {
    readonly code = "SEMANTIC_SOURCE_CAPACITY";
}
/** Fresh tool-free DSH requests. Generation and verification never enter the chat session. */
export declare function rewriteMemorySummary(ctx: Context, request: SemanticRequest, signal: AbortSignal, checkSources: () => void, timeoutMs: number, maxOutputTokens: number, maxInputBytes: number): Promise<SemanticResult>;
