import type { BiliReadingRecord } from '@dafeiyu/contracts';

/**
 * Bounded projection of reading progress for the working context.
 *
 * Full records, subtitles, comments and frames stay in the local store. The
 * model only carries counts, the most recent conclusions and the next step, so
 * twenty finished videos cost about as much context as eight.
 */
export interface BoundedReadingView {
    readonly total: number;
    readonly open: { bvid: string; title: string; nextStep: string | null } | null;
    readonly recent: readonly { bvid: string; title: string; status: BiliReadingRecord['status']; conclusion: string | null }[];
    readonly reopen: readonly string[];
}

const clip = (text: string, limit: number) => Array.from(text).slice(0, limit).join('');

export function boundedReadingView(records: readonly BiliReadingRecord[], limit = 8): BoundedReadingView {
    const bounded = Math.max(1, Math.min(8, Math.trunc(limit)));
    const ordered = [...records];
    const open = ordered.find(record => record.status !== 'closed') ?? null;
    return {
        total: ordered.length,
        open: open ? { bvid: open.bvid, title: open.title, nextStep: open.nextStep === null ? null : clip(open.nextStep, 200) } : null,
        recent: ordered.slice(0, bounded).map(record => ({
            bvid: record.bvid,
            title: clip(record.title, 160),
            status: record.status,
            conclusion: record.conclusion === null ? null : clip(record.conclusion, 300),
        })),
        reopen: ordered.slice(0, bounded).map(record => record.bvid),
    };
}
