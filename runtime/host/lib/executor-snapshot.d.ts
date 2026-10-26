import { z } from 'zod';
export declare const ExecutorFileSnapshotSchema: z.ZodObject<{
    relative: z.ZodString;
    bytes: z.ZodNumber;
    hash: z.ZodString;
}, z.core.$strict>;
export type ExecutorFileSnapshot = z.infer<typeof ExecutorFileSnapshotSchema>;
/** Only the service's formal envelope directory is included, never temporary or DSH session roots. */
export declare function executorSnapshotPath(root: string, part: string): string;
/** Read-only receipt checks retain unreferenced envelopes without turning them into successful outcomes. */
export declare function executorFilesSnapshot(coreDir: string): ExecutorFileSnapshot[];
export declare function verifyExecutorBackup(destination: string, files: readonly ExecutorFileSnapshot[]): void;
export declare function copyExecutorSnapshot(coreDir: string, destination: string, files: readonly ExecutorFileSnapshot[]): void;
