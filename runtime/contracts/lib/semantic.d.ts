import { z } from 'zod';
import type { CompactionSource, SummaryFragment } from './compaction.js';
export declare const qualifierSchema: z.ZodObject<{
    seq: z.ZodNumber;
    role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>;
    start: z.ZodNumber;
    end: z.ZodNumber;
    text: z.ZodString;
}, z.core.$strict>;
export declare const semanticResultSchema: z.ZodObject<{
    fragment: z.ZodObject<{
        kind: z.ZodEnum<{
            fact: "fact";
            decision: "decision";
            constraint: "constraint";
            correction: "correction";
            pending: "pending";
            uncertainty: "uncertainty";
            result: "result";
            note: "note";
        }>;
        text: z.ZodString;
    }, z.core.$strict>;
    qualifiers: z.ZodArray<z.ZodObject<{
        seq: z.ZodNumber;
        role: z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        start: z.ZodNumber;
        end: z.ZodNumber;
        text: z.ZodString;
    }, z.core.$strict>>;
    verification: z.ZodObject<{
        compatible: z.ZodLiteral<true>;
        faithful: z.ZodLiteral<true>;
        issues: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    model: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type SemanticResult = z.infer<typeof semanticResultSchema>;
export interface SemanticRequest {
    mode: 'fusion' | 'rebuild';
    sources: readonly CompactionSource[];
    parents: readonly SummaryFragment[];
    maxChars: number;
}
/** Conservative, verbatim clause anchors. UTF-16 offsets refer to the complete stored text.
 * Channel envelope fields are not user statements; role/source identity remains in proof. */
export declare function extractQualifiers(sources: readonly CompactionSource[]): SemanticResult['qualifiers'];
/** Exact anchoring cannot prove complete semantic fidelity; independent verification is
 * mandatory too. Failure leaves existing valid fragments untouched. */
export declare function checkSemanticResult(request: SemanticRequest, value: unknown): SemanticResult;
