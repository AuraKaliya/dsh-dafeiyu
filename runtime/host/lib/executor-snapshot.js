import { createHash } from 'node:crypto';
import { closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ExecutorReceiptSchema, executorHash } from '#dafeiyu/server-executor/types';
const resultRef = z.string().regex(/^results\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/);
export const ExecutorFileSnapshotSchema = z.strictObject({ relative: resultRef, bytes: z.number().int().nonnegative().max(64 * 1024 * 1024), hash: z.string().regex(/^[a-f0-9]{64}$/) });
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
/** Only the service's formal envelope directory is included, never temporary or DSH session roots. */
export function executorSnapshotPath(root, part) {
    resultRef.parse(part);
    const directory = resolve(root), results = join(directory, 'results'), file = join(directory, part);
    for (const path of [directory, results, file])
        if (existsSync(path)) {
            if (lstatSync(path, { bigint: true }).isSymbolicLink() || !samePath(realpathSync.native(path), path))
                throw new Error('MIGRATION_EXECUTOR_LINK_UNSUPPORTED');
        }
    return file;
}
function snapshotFile(root, part) {
    const file = executorSnapshotPath(root, part), handle = openSync(file, 'r');
    try {
        const before = fstatSync(handle, { bigint: true });
        if (!before.isFile() || before.size > 64n * 1024n * 1024n)
            throw new Error('MIGRATION_EXECUTOR_FILE_UNSUPPORTED');
        const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
        let bytes = 0, count;
        while ((count = readSync(handle, buffer, 0, buffer.length, null)) > 0) {
            bytes += count;
            if (bytes > 64 * 1024 * 1024)
                throw new Error('MIGRATION_EXECUTOR_FILE_UNSUPPORTED');
            hash.update(buffer.subarray(0, count));
        }
        const after = fstatSync(handle, { bigint: true }), current = lstatSync(executorSnapshotPath(root, part), { bigint: true }), readBytes = BigInt(bytes);
        if (before.size !== readBytes || after.size !== readBytes || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || after.dev !== current.dev || after.ino !== current.ino || after.size !== current.size || after.mtimeNs !== current.mtimeNs || after.ctimeNs !== current.ctimeNs)
            throw new Error('MIGRATION_EXECUTOR_CHANGED');
        return { relative: part, bytes, hash: hash.digest('hex') };
    }
    finally {
        closeSync(handle);
    }
}
function archiveFiles(root) {
    const directory = join(root, 'results');
    if (!existsSync(directory))
        return [];
    executorSnapshotPath(root, 'results/00000000-0000-0000-0000-000000000000.json');
    if (!lstatSync(directory, { bigint: true }).isDirectory())
        throw new Error('MIGRATION_EXECUTOR_FILE_UNSUPPORTED');
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.length > 100000)
        throw new Error('MIGRATION_EXECUTOR_COUNT_LIMIT');
    return entries.map(entry => { if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error('MIGRATION_EXECUTOR_FILE_UNSUPPORTED'); return snapshotFile(root, 'results/' + entry.name); }).sort((a, b) => a.relative.localeCompare(b.relative));
}
/** Read-only receipt checks retain unreferenced envelopes without turning them into successful outcomes. */
export function executorFilesSnapshot(coreDir) {
    const files = archiveFiles(coreDir), byRef = new Map(files.map(file => [file.relative, file])), database = join(coreDir, 'executor.sqlite');
    if (!existsSync(database))
        return files;
    const db = new DatabaseSync(database, { readOnly: true });
    try {
        db.exec('BEGIN');
        for (const row of db.prepare('SELECT id,job_id,body,body_hash FROM executor_receipts').iterate()) {
            const receipt = ExecutorReceiptSchema.parse(JSON.parse(String(row.body)));
            if (receipt.id !== row.id || receipt.jobId !== row.job_id || executorHash(receipt) !== row.body_hash)
                throw new Error('MIGRATION_EXECUTOR_RECEIPT_INVALID');
            if (!receipt.output)
                continue;
            if (receipt.output.relative !== `results/${receipt.jobId}.json`)
                throw new Error('MIGRATION_EXECUTOR_RESULT_PATH_INVALID');
            const file = byRef.get(receipt.output.relative);
            if (!file || file.hash !== receipt.output.hash || file.bytes !== receipt.output.bytes)
                throw new Error('MIGRATION_EXECUTOR_RESULT_MISSING_OR_CHANGED');
        }
        db.exec('COMMIT');
    }
    finally {
        db.close();
    }
    return files;
}
export function verifyExecutorBackup(destination, files) {
    if (JSON.stringify(archiveFiles(destination)) !== JSON.stringify(files))
        throw new Error('MIGRATION_EXECUTOR_BACKUP_INVALID');
}
export function copyExecutorSnapshot(coreDir, destination, files) {
    for (const item of files) {
        const source = executorSnapshotPath(coreDir, item.relative), target = executorSnapshotPath(destination, item.relative);
        mkdirSync(join(destination, 'results'), { recursive: true });
        executorSnapshotPath(destination, item.relative);
        copyFileSync(source, target, constants.COPYFILE_EXCL);
    }
    verifyExecutorBackup(destination, files);
}
