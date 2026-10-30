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
    const comments = data.filter(entry => entry.page.kind === 'comments' && aid !== null && entry.body.aid === aid);

    const watched = matched.flatMap(entry => {
        if (entry.page.kind !== 'subtitles') return [];
        const cid = typeof entry.body.cid === 'string' ? entry.body.cid : null;
        const range = z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).safeParse(entry.body.range);
        return cid && range.success && range.data.endMs > range.data.startMs ? [{ cid, startMs: range.data.startMs, endMs: range.data.endMs }] : [];
    });

    const cursorSource = comments.at(-1);
    const cursorPage = cursorSource && typeof cursorSource.body.page === 'number' ? cursorSource.body.page : null;
    const commentCursor = aid && cursorPage !== null
        ? { aid, parent: typeof cursorSource!.body.parent === 'string' ? cursorSource!.body.parent : null, sort: 'hot' as const, page: cursorPage, seen: [] }
        : null;

    const frames = matched.flatMap(entry => {
        if (entry.page.kind !== 'browser' && entry.page.kind !== 'media') return [];
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
