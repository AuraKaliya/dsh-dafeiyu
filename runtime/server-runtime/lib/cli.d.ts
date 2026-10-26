import type { ModelBudgetAuthority } from './types.js';
import type { ServerRuntimeStop } from './launch-state.js';
export interface ServerCommand {
    readonly mode: 'inspect' | 'status' | 'start' | 'run';
    readonly manifest: string;
    readonly request?: string;
}
export declare function parseServerCommand(args: readonly string[]): ServerCommand;
export declare function classifyServerRuntimeStop(code: string): ServerRuntimeStop;
/** Start/run borrow a trusted port. JSON cannot create money or load an authority module. */
export declare function runServerCommand(command: ServerCommand, write?: (value: unknown) => void, authority?: ModelBudgetAuthority): Promise<number>;
