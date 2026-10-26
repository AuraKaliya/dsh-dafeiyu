import { z } from 'zod';
export declare const MediaFileSnapshotSchema: z.ZodObject<{
    relative: z.ZodString;
    bytes: z.ZodNumber;
    hash: z.ZodString;
}, z.core.$strict>;
export type MediaFileSnapshot = z.infer<typeof MediaFileSnapshotSchema>;
export declare function mediaSnapshotPath(root: string, part: string): string;
export declare function mediaFilesSnapshot(coreDir: string): Promise<MediaFileSnapshot[]>;
export declare function copyMediaSnapshot(coreDir: string, destination: string, files: readonly MediaFileSnapshot[]): Promise<void>;
export declare function verifyMediaBackup(destination: string, files: readonly MediaFileSnapshot[]): Promise<void>;
