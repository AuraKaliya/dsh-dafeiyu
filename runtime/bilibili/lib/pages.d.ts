import { z } from 'zod';
export declare const platformId: z.ZodUnion<readonly [z.ZodString, z.ZodPipe<z.ZodNumber, z.ZodTransform<string, number>>]>;
export declare function plain(text: string, limit: number): string;
export declare function listing(raw: unknown, kind: 'discover' | 'search', page: number, limit: number): {
    data: {
        items: {
            bvid: string;
            aid: string | null;
            title: string;
            author: string;
            durationSeconds: number | null;
        }[];
        page: number;
        limit: number;
        nextPage: number | null;
    };
    fields: {
        id: string;
        text: string;
    }[];
    count: number;
    coverage: string[];
};
export declare function video(raw: unknown): {
    data: {
        bvid: string;
        aid: string;
        title: string;
        description: string;
        author: {
            uid: string;
            name: string;
        };
        durationSeconds: number;
        pages: {
            cid: string;
            page: number;
            title: string;
            durationSeconds: number;
        }[];
        totalParts: number;
    };
    fields: {
        id: string;
        text: string;
    }[];
    count: number;
    coverage: string[];
};
export declare function comments(raw: unknown, aid: string, page: number, limit: number, parent: string | null): {
    data: {
        aid: string;
        parent: string | null;
        page: number;
        limit: number;
        items: {
            id: string;
            parent: string | null;
            root: string | null;
            author: string;
            text: string;
            likes: number | null;
            replies: number | null;
        }[];
        nextPage: number | null;
    };
    fields: {
        id: string;
        text: string;
    }[];
    count: number;
    coverage: string[];
};
