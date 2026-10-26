import { z } from 'zod';
import type { OperationScope, TimelineScope } from '#dafeiyu/contracts';
import type { NewEvent } from '#dafeiyu/journal';
export declare const sourceVersionSchema: z.ZodObject<{
    evidence: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"capability">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"observation">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"timeline">;
        ref: z.ZodString;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        id: z.ZodUUID;
        revision: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    version: z.ZodNullable<z.ZodNumber>;
    ancestors: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        revision: z.ZodNumber;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>>>;
    sourceFences: z.ZodOptional<z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        contentHash: z.ZodString;
        fence: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const workEntrySchema: z.ZodObject<{
    id: z.ZodString;
    category: z.ZodEnum<{
        result: "result";
        goal: "goal";
        constraint: "constraint";
        correction: "correction";
        pending: "pending";
        gap: "gap";
    }>;
    text: z.ZodString;
    sources: z.ZodArray<z.ZodObject<{
        evidence: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"capability">;
            ref: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution">;
            ref: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"observation">;
            ref: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"timeline">;
            ref: z.ZodString;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            id: z.ZodUUID;
            revision: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        version: z.ZodNullable<z.ZodNumber>;
        ancestors: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodUUID;
            revision: z.ZodNumber;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>>>;
        sourceFences: z.ZodOptional<z.ZodArray<z.ZodObject<{
            ref: z.ZodString;
            contentHash: z.ZodString;
            fence: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const selectedSchema: z.ZodObject<{
    id: z.ZodUUID;
    revision: z.ZodNumber;
    version: z.ZodNumber;
    contentHash: z.ZodString;
    start: z.ZodNumber;
    end: z.ZodNumber;
    ancestors: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        revision: z.ZodNumber;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>>>;
    sourceFences: z.ZodOptional<z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        contentHash: z.ZodString;
        fence: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const stateSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"working">;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        category: z.ZodEnum<{
            result: "result";
            goal: "goal";
            constraint: "constraint";
            correction: "correction";
            pending: "pending";
            gap: "gap";
        }>;
        text: z.ZodString;
        sources: z.ZodArray<z.ZodObject<{
            evidence: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"capability">;
                ref: z.ZodString;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"execution">;
                ref: z.ZodString;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"observation">;
                ref: z.ZodString;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"timeline">;
                ref: z.ZodString;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"memory">;
                id: z.ZodUUID;
                revision: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>], "kind">;
            version: z.ZodNullable<z.ZodNumber>;
            ancestors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodUUID;
                revision: z.ZodNumber;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>>>;
            sourceFences: z.ZodOptional<z.ZodArray<z.ZodObject<{
                ref: z.ZodString;
                contentHash: z.ZodString;
                fence: z.ZodString;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    version: z.ZodNumber;
    taskId: z.ZodString;
    expiresAt: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"evidence">;
    workingVersion: z.ZodOptional<z.ZodNumber>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        revision: z.ZodNumber;
        version: z.ZodNumber;
        contentHash: z.ZodString;
        start: z.ZodNumber;
        end: z.ZodNumber;
        ancestors: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodUUID;
            revision: z.ZodNumber;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>>>;
        sourceFences: z.ZodOptional<z.ZodArray<z.ZodObject<{
            ref: z.ZodString;
            contentHash: z.ZodString;
            fence: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    version: z.ZodNumber;
    taskId: z.ZodString;
    expiresAt: z.ZodISODateTime;
}, z.core.$strict>], "kind">;
export type WorkingState = z.infer<typeof stateSchema>;
export type WorkEntry = z.infer<typeof workEntrySchema>;
export type SelectedMemory = z.infer<typeof selectedSchema>;
/** Scope-bound working state and selected citations, separate from long-term memory revisions. */
export declare class WorkingStore {
    private readonly db;
    constructor(file: string);
    read(scope: TimelineScope, kind: 'working' | 'evidence'): WorkingState | null;
    /** Version of this item's current uninterrupted content, independent of sibling edits. */
    itemVersion(scope: TimelineScope, id: string): number;
    version(scope: TimelineScope, kind: 'working' | 'evidence'): number;
    write(scope: OperationScope, requestId: string, expectedVersion: number, state: WorkingState): {
        duplicate: boolean;
        kind: "evidence" | "working";
        version: number;
        eventId: string;
    };
    flush(publish: (event: NewEvent, id: string) => void): void;
    close(): void;
}
