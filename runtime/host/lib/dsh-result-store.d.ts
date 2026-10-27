import type { Json, DshResultRead, Conversation } from '#dafeiyu/contracts';
/** Immutable, sanitized task results. A page contains whole JSON values or explicit child handles. */
export declare class DshResultStore {
    private readonly directory;
    constructor(directory: string);
    private file;
    save(id: string, taskId: string, scene: Conversation | null, result: Json): void;
    read(taskId: string, scene: Conversation | null, raw: DshResultRead): Json;
}
