import { z } from 'zod';

/**
 * Deterministic decision for continuing one task in a new execution segment.
 *
 * The runtime owns when a segment ends; this policy only answers whether the
 * last finished segment left bounded, resumable work. It never inspects model
 * output and never counts tokens: the first version segments on finished
 * reading units, which is reproducible in tests.
 */
export const ReadingSegmentPolicySchema = z.strictObject({
    segmentsPerRun: z.number().int().min(1).max(16).default(3),
    maxSegments: z.number().int().min(1).max(64).default(8),
});
export type ReadingSegmentPolicy = z.infer<typeof ReadingSegmentPolicySchema>;

export interface SegmentCheckpoint {
    /** Checkpoint kind written by the program; only reading units can continue a segment. */
    readonly kind: string;
    readonly nextStep: string | null;
}

export interface SegmentInput {
    /** Checkpoints written during the segment that just finished, oldest first. */
    readonly checkpoints: readonly SegmentCheckpoint[];
    /** Task state as read before completing the run. */
    readonly task: { readonly status: 'active' | 'paused' | 'completed'; readonly epoch: number };
    /** Epoch this run was accepted under. */
    readonly intentVersion: number;
    /** How many continuation runs the task already chained. */
    readonly segments: number;
    readonly policy?: Partial<ReadingSegmentPolicy> | undefined;
}

export interface SegmentDecision {
    readonly next: 'continue' | 'stop';
    readonly checkpointId?: number;
    readonly reason: 'reading-work-left' | 'no-reading-work' | 'task-inactive' | 'stale-epoch' | 'segment-cap';
}

/** `checkpointId` is the index of the checkpoint to hand off; the caller owns the id mapping. */
export function readingSegmentDecision(input: SegmentInput): SegmentDecision {
    const policy = ReadingSegmentPolicySchema.parse(input.policy ?? {});
    if (input.task.status !== 'active') return { next: 'stop', reason: 'task-inactive' };
    if (input.task.epoch !== input.intentVersion) return { next: 'stop', reason: 'stale-epoch' };
    if (input.segments >= policy.maxSegments) return { next: 'stop', reason: 'segment-cap' };
    const reading = input.checkpoints.filter(checkpoint => checkpoint.kind === 'reading');
    if (reading.length < policy.segmentsPerRun) return { next: 'stop', reason: 'no-reading-work' };
    const last = reading.at(-1)!;
    if (last.nextStep === null) return { next: 'stop', reason: 'no-reading-work' };
    return { next: 'continue', checkpointId: input.checkpoints.indexOf(last), reason: 'reading-work-left' };
}
