import type { Context } from '@deepseek-ai/cordis';
import type { ChildProcess } from 'node:child_process';
import type { Json } from '#dafeiyu/contracts';
declare module '@deepseek-ai/dsh-session' {
    interface SessionEventMap {
        'plugin:dafeiyu/dsh-dispatch': {
            schemaVersion: 1;
            runId: string;
            operationId: string;
            tool: string;
            source: Json;
        };
        'plugin:dafeiyu/dsh-completed': {
            schemaVersion: 1;
            runId: string;
            operationId: string;
            tool: string;
            isError: boolean;
            effect: 'none' | 'confirmed' | 'unknown';
        };
    }
}
/** Official Tools dispatch in a preset-bound DSH Agent. This Agent never calls a model. */
export declare function attachDshBridge(ctx: Context, child: ChildProcess, settingsFile: string): () => Promise<void>;
