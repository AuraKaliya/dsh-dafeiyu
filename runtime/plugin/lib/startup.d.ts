type Dispose = () => void | Promise<void>;
/** Keep lazy imports and child creation outside the host's startup barrier. */
export declare function deferPluginStart(ready: unknown, launch: (signal: AbortSignal) => Promise<Dispose>, failed: (error: unknown) => void): () => Promise<void>;
export {};
