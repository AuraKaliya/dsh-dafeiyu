/** SQLite journal-mode changes can report BUSY immediately despite busy_timeout. Retry only that setup step within the same time budget. */
export function configureSqlite(db, busyTimeoutMs = 5000) {
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 1 || busyTimeoutMs > 30000)
        throw new Error('Invalid SQLite setup timeout');
    db.exec(`PRAGMA foreign_keys=ON;PRAGMA busy_timeout=${busyTimeoutMs};`);
    const deadline = performance.now() + busyTimeoutMs, sleeper = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
        try {
            const mode = db.prepare('PRAGMA journal_mode').get()?.journal_mode;
            if (mode !== 'wal')
                db.exec('PRAGMA journal_mode=WAL;');
            break;
        }
        catch (error) {
            const code = error instanceof Error ? Reflect.get(error, 'errcode') : undefined;
            const busy = typeof code === 'number' && ([5, 6].includes(code & 255));
            const remaining = deadline - performance.now();
            if (!busy || remaining <= 0)
                throw error;
            Atomics.wait(sleeper, 0, 0, Math.min(25, remaining));
        }
    }
    db.exec('PRAGMA synchronous=FULL;');
}
