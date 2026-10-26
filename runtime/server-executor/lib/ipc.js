import { z } from 'zod';
function endpoint(node) {
    if (typeof node.send !== 'function' || !node.connected)
        throw new Error('EXECUTOR_IPC_REQUIRED');
    return { send: async (raw) => {
            const value = z.record(z.string(), z.json()).parse(raw);
            if (!node.connected || !node.send)
                throw new Error('EXECUTOR_IPC_CLOSED');
            await new Promise((resolve, reject) => { try {
                node.send(value, error => error ? reject(new Error('EXECUTOR_IPC_SEND_FAILED')) : resolve());
            }
            catch {
                reject(new Error('EXECUTOR_IPC_SEND_FAILED'));
            } });
        },
        subscribe: (message, disconnected) => { node.on('message', message); node.on('disconnect', disconnected); return () => { node.removeListener('message', message); node.removeListener('disconnect', disconnected); }; },
        disconnect: () => { if (node.connected)
            node.disconnect?.(); } };
}
export const parentIpcEndpoint = (child) => endpoint(child);
export const childIpcEndpoint = () => endpoint({
    get connected() { return process.connected; },
    send: (value, callback) => { if (!process.send)
        throw new Error('EXECUTOR_IPC_REQUIRED'); return process.send(value, undefined, undefined, callback); },
    on: process.on.bind(process), removeListener: process.removeListener.bind(process), disconnect: () => process.disconnect?.(),
});
