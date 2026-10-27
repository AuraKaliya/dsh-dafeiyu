/** Startup metadata contains no error message, arguments, environment, or full path. */
export function startupFailure(stage, error) {
    const record = error instanceof Error ? error : undefined, code = record && 'code' in record && typeof record.code === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(record.code) ? record.code : undefined;
    const name = record && ['Error', 'TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'AbortError'].includes(record.name) ? record.name : 'UnknownError';
    const text = record?.message ?? '', category = /Invalid URL/i.test(text) ? 'invalid-url' : /not provide an export|does not provide.*export/.test(text) ? 'missing-export' : /not a function/.test(text) ? 'not-a-function' : /Cannot read properties/.test(text) ? 'missing-property' : 'other';
    const missingPackage = /Cannot find package ['"]((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)['"]/.exec(text)?.[1];
    const frames = [...(record?.stack ?? '').matchAll(/[\\/]([A-Za-z0-9_.-]+\.(?:m?js|cjs|ts)):(\d+):\d+/g)].slice(0, 4).map(match => ({ file: match[1], line: Number(match[2]) }));
    return { stage, name, ...(code ? { code } : {}), category, ...(missingPackage ? { missingPackage } : {}), frames };
}
function isHostReady(value) { return !!value && typeof value === 'object' && 'onReady' in value && typeof value.onReady === 'function'; }
/** Keep lazy imports and child creation outside the host's startup barrier. */
export function deferPluginStart(ready, launch, failed) {
    if (ready !== undefined && !isHostReady(ready))
        throw new Error('INSTALL_DSH_READINESS_INVALID');
    const controller = new AbortController();
    let running, closing;
    const start = () => { if (controller.signal.aborted || running)
        return; running = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return launch(controller.signal); }); void running.catch(error => { if (!controller.signal.aborted)
        failed(error); }); };
    const cancel = isHostReady(ready) ? ready.onReady(start) : undefined;
    if (ready === undefined)
        start();
    return () => closing ??= (async () => { controller.abort(); cancel?.(); const dispose = await running?.catch(() => undefined); await dispose?.(); })();
}
