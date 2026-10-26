import type { ChildProcess } from 'node:child_process';
import type { ExecutorIpcEndpoint } from './protocol.js';
export declare const parentIpcEndpoint: (child: ChildProcess) => ExecutorIpcEndpoint;
export declare const childIpcEndpoint: () => ExecutorIpcEndpoint;
