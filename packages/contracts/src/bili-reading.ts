import { z } from 'zod';

/**
 * Shape contracts for the Bilibili reading pipeline.
 *
 * The program owns navigation, fetching, caching, cursors and context assembly.
 * The persona owns selection, understanding and judgement. These schemas are the
 * negotiated boundary: they are transport-agnostic (HTTP or browser), always
 * carry per-item coverage, and never smuggle a full transcript into one field.
 */

const bvid = z.string().regex(/^BV[1-9A-HJ-NP-Za-km-z]{10}$/);
const platformId = z.string().regex(/^[1-9]\d{0,19}$/);
const moment = z.iso.datetime();
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/);
const text = (max: number) => z.string().max(max);
const coverage = z.array(text(200)).max(8).default([]);

/** Keyword-first search. The caller binds the request to the current task; no source-id arithmetic. */
export const BiliSearchQuerySchema = z.strictObject({
    keyword: z.string().trim().min(1).max(100),
    order: z.enum(['totalrank', 'pubdate', 'click']).default('totalrank'),
    page: z.number().int().min(1).max(50).default(1),
    limit: z.number().int().min(1).max(20).default(10),
});

/** One candidate. Missing platform fields stay null instead of being guessed. */
export const BiliSearchItemSchema = z.strictObject({
    bvid,
    aid: platformId.nullable().default(null),
    title: text(160),
    author: text(80).default(''),
    publishedAt: moment.nullable().default(null),
    views: z.number().int().nonnegative().nullable().default(null),
    durationSeconds: z.number().int().nonnegative().nullable().default(null),
});

export const BiliSearchResultSchema = z.strictObject({
    keyword: z.string().trim().min(1).max(100),
    order: z.enum(['totalrank', 'pubdate', 'click']),
    page: z.number().int().min(1).max(50),
    limit: z.number().int().min(1).max(20),
    items: z.array(BiliSearchItemSchema).max(20),
    nextPage: z.number().int().min(2).max(50).nullable(),
    coverage,
});

/** A comment page is addressed by a cursor, not by re-reading the first page. */
export const BiliCommentCursorSchema = z.strictObject({
    aid: platformId,
    parent: platformId.nullable().default(null),
    sort: z.enum(['time', 'hot']).default('hot'),
    page: z.number().int().min(1).max(1000).default(1),
    seen: z.array(platformId).max(500).default([]),
});

export const BiliCommentItemSchema = z.strictObject({
    id: platformId,
    rootId: platformId.nullable().default(null),
    parentId: platformId.nullable().default(null),
    author: text(60),
    text: text(400),
    likes: z.number().int().nonnegative().nullable().default(null),
    replies: z.number().int().nonnegative().nullable().default(null),
});

export const BiliCommentPageSchema = z.strictObject({
    cursor: BiliCommentCursorSchema,
    items: z.array(BiliCommentItemSchema).max(20),
    nextCursor: BiliCommentCursorSchema.nullable(),
    coverage,
});

/** Batch frame acquisition: one navigation, several points, per-point status. */
export const BiliFrameBatchRequestSchema = z.strictObject({
    bvid,
    pointsMs: z.array(z.number().int().nonnegative().max(21600000)).min(1).max(6),
}).superRefine((value, ctx) => {
    if (new Set(value.pointsMs).size !== value.pointsMs.length)
        ctx.addIssue({ code: 'custom', path: ['pointsMs'], message: 'Frame points must be distinct' });
});

export const BiliFramePointSchema = z.strictObject({
    positionMs: z.number().int().nonnegative(),
    sourceKey: text(200).nullable().default(null),
    ok: z.boolean(),
    errorCode: code.nullable().default(null),
});

export const BiliFrameBatchResultSchema = z.strictObject({
    bvid,
    points: z.array(BiliFramePointSchema).max(6),
    reused: z.boolean().default(false),
    coverage,
});

/** Per-video reading record: program records facts and progress, the persona records judgement. */
export const BiliReadingRecordSchema = z.strictObject({
    schemaVersion: z.literal(1),
    bvid,
    aid: platformId.nullable().default(null),
    title: text(160),
    author: text(80).default(''),
    status: z.enum(['open', 'checkpoint', 'closed']),
    watched: z.array(z.strictObject({
        cid: platformId,
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
    })).max(200),
    commentCursor: BiliCommentCursorSchema.nullable().default(null),
    frames: z.array(z.strictObject({ positionMs: z.number().int().nonnegative(), sourceKey: text(200).nullable() })).max(32),
    sources: z.array(text(200)).max(64),
    conclusion: text(2000).nullable().default(null),
    gaps: z.array(text(200)).max(20),
    nextStep: text(300).nullable().default(null),
    updatedAt: moment,
}).superRefine((value, ctx) => {
    for (const range of value.watched)
        if (range.endMs <= range.startMs)
            ctx.addIssue({ code: 'custom', path: ['watched'], message: 'Watched ranges must advance' });
    if (value.status === 'closed' && value.conclusion === null && value.gaps.length === 0)
        ctx.addIssue({ code: 'custom', path: ['conclusion'], message: 'A closed record needs a conclusion or a recorded gap' });
});

/** Bounded projection carried in long-task context; the full record stays on disk. */
export const BiliReadingIndexSchema = z.strictObject({
    total: z.number().int().nonnegative(),
    recent: z.array(z.strictObject({
        bvid,
        title: text(160),
        status: z.enum(['open', 'checkpoint', 'closed']),
        conclusion: text(300).nullable(),
    })).max(8),
    highlights: z.array(z.strictObject({ bvid, reason: text(200) })).max(8),
    next: text(300).nullable().default(null),
});

export type BiliSearchQuery = z.infer<typeof BiliSearchQuerySchema>;
export type BiliSearchItem = z.infer<typeof BiliSearchItemSchema>;
export type BiliSearchResult = z.infer<typeof BiliSearchResultSchema>;
export type BiliCommentCursor = z.infer<typeof BiliCommentCursorSchema>;
export type BiliCommentItem = z.infer<typeof BiliCommentItemSchema>;
export type BiliCommentPage = z.infer<typeof BiliCommentPageSchema>;
export type BiliFrameBatchRequest = z.infer<typeof BiliFrameBatchRequestSchema>;
export type BiliFramePoint = z.infer<typeof BiliFramePointSchema>;
export type BiliFrameBatchResult = z.infer<typeof BiliFrameBatchResultSchema>;
export type BiliReadingRecord = z.infer<typeof BiliReadingRecordSchema>;
export type BiliReadingIndex = z.infer<typeof BiliReadingIndexSchema>;
