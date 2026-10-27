type Dispose = () => void | Promise<void>;
export type StartupStage = 'settings-import' | 'bridge-import' | 'child-spawn' | 'bridge-attach';
/** Startup metadata contains no error message, arguments, environment, or full path. */
export declare function startupFailure(stage: StartupStage, error: unknown): {
    frames: {
        file: string | undefined;
        line: number;
    }[];
    missingPackage?: string;
    category: string;
    code?: string;
    stage: StartupStage;
    name: string;
};
/** Keep lazy imports and child creation outside the host's startup barrier. */
export declare function deferPluginStart(ready: unknown, launch: (signal: AbortSignal) => Promise<Dispose>, failed: (error: unknown) => void): () => Promise<void>;
export {};
