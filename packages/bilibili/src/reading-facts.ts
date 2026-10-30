import { z } from 'zod';

import type { BiliPage } from './store.js';

export interface ReadingFacts {
    readonly watched: readonly { cid: string; startMs: number; endMs: number }[];
    readonly commentCursor: { aid: string; parent: string | null; sort: 'time' | 'hot'; page: number; seen: string[] } | null;
    readonly frames: readonly { positionMs: number; sourceKey: string | null }[];
    readonly sources: readonly string[];
    readonly title: string | null;
    readonly author: string | null;
}

const frame = z.object({ positionMs: z.number().int().nonnegative(), sourceKey: z.string().max(200).nullable() });

const cursor = z.object({ aid: z.string(), parent: z.string().nullable().optional(), sort: z.enum(['time', 'hot']).optional(), page: z.number().int().min(1).optional(), seen: z.array(z.string()).optional() });
const framePoint = z.object({ positionMs: z.number().int().nonnegative(), sourceKey: z.string().max(200).nullable(), ok: z.boolean(), errorCode: z.string().nullable().optional() });
function cursorOf(body: Record<string, z.infer<typeof z.json>>) {
    const parsed = cursor.safeParse(body.cursor);
    if (parsed.success) return parsed.data;
    const legacy = cursor.safeParse({ aid: body.aid, page: body.page, parent: body.parent, sort: body.sort });
    return legacy.success ? legacy.data : null;
}
function value(page: BiliPage): Record<string, z.infer<typeof z.json>> {
    const parsed = z.record(z.string(), z.json()).safeParse(page.data);
    return parsed.success ? parsed.data : {};
}

/**
 * Facts are derived from pages this task actually observed. A judgement-only
 * save must never be able to invent a range, cursor or frame.
 */
export function readingFacts(pages: readonly BiliPage[], bvid: string): ReadingFacts {
    const data = pages.map(page => ({ page, body: value(page) }));
    const video = data.find(entry => entry.page.kind === 'video' && entry.body.bvid === bvid);
    const aid = typeof video?.body.aid === 'string' ? video.body.aid : null;
    const matched = data.filter(entry => entry.body.bvid === bvid);
    const comments = data.filter(entry => {
        if (entry.page.kind !== 'comments') return false;
        const cursor = cursorOf(entry.body);
        return aid !== null && cursor?.aid === aid;
    });

    const watched = matched.flatMap(entry => {
        if (entry.page.kind !== 'subtitles') return [];
        const cid = typeof entry.body.cid === 'string' ? entry.body.cid : null;
        const range = z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).safeParse(entry.body.range);
        return cid && range.success && range.data.endMs > range.data.startMs ? [{ cid, startMs: range.data.startMs, endMs: range.data.endMs }] : [];
    });

    const cursorSource = comments.at(-1), stable = cursorSource ? cursorOf(cursorSource.body) : null;
    const commentCursor = aid && stable
        ? { aid, parent: stable.parent ?? null, sort: stable.sort ?? 'hot' as const, page: stable.page ?? 1, seen: stable.seen ?? [] }
        : null;

    const frames = matched.flatMap(entry => {
        if (entry.page.kind !== 'browser' && entry.page.kind !== 'media') return [];
        const points = z.array(framePoint).safeParse(entry.body.points);
        if (points.success) return points.data.filter(point => point.ok).map(point => ({ positionMs: point.positionMs, sourceKey: point.sourceKey }));
        const capture = z.object({ source: z.object({ key: z.string().max(200) }), positionMs: z.number().int().nonnegative() }).safeParse(entry.page.kind === 'browser' ? entry.body.capture : entry.body);
        return capture.success ? [{ positionMs: capture.data.positionMs, sourceKey: capture.data.source.key }] : [];
    });

    const sources = [...new Set([...matched, ...comments].map(entry => 'page:' + entry.page.id))].sort();
    return {
        watched, commentCursor, frames, sources,
        title: video && typeof video.body.title === 'string' ? video.body.title : null,
        author: video && typeof video.body.author === 'object' && video.body.author !== null && typeof (video.body.author as Record<string, unknown>).name === 'string'
            ? String((video.body.author as Record<string, unknown>).name) : null,
    };
}
