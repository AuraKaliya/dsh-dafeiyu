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
