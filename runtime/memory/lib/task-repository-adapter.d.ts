import type { TaskRepositoryPort } from '#dafeiyu/contracts';
import type { TaskWorkspace } from './task-workspace.js';
export declare function taskRepository(tasks: TaskWorkspace, agentId: string, available: () => void, ready: () => boolean, flush: () => void, sourceIdentity?: (route: string, ref: string) => string | null): TaskRepositoryPort;
