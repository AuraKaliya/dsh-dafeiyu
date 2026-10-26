import { z } from 'zod';
import { TaskDeliverySubmitSchema } from '#dafeiyu/contracts';
import type { TaskExpressionProvider } from '#dafeiyu/contracts';
import type { TaskMemoryProvider } from '#dafeiyu/contracts';
import type { TaskController, TaskPluginAPI, TaskWorkspaceProvider, ObservationAuthority, Conversation, ActionContext } from '#dafeiyu/contracts';
export declare function bindTaskMemoryProvider(p: TaskMemoryProvider): TaskMemoryProvider;
export declare function bindExpressionProvider(p: TaskExpressionProvider): TaskExpressionProvider;
export declare function bindTaskProvider(p: TaskWorkspaceProvider): TaskWorkspaceProvider;
/** Non-model coordinator capabilities. Scene handlers receive references/tickets, never
 * the coordinator's private read function or a caller-selectable global scope. */
export declare class TaskCoordinator {
    private readonly agentId;
    private readonly provider;
    private readonly assertOpen;
    private readonly memoryProvider;
    private readonly expressionProvider;
    private readonly deliveryHost;
    private readonly references;
    private readonly jobs;
    constructor(agentId: string, provider: () => TaskWorkspaceProvider | undefined, assertOpen: () => void, memoryProvider: () => TaskMemoryProvider | undefined, expressionProvider: () => TaskExpressionProvider | undefined, deliveryHost: {
        submit: (taskId: string, input: z.output<typeof TaskDeliverySubmitSchema>, signal: AbortSignal, guard: () => void) => Promise<Record<string, unknown>>;
        status: (taskId: string, id: string) => Record<string, unknown>;
    });
    private expression;
    expressionPolicy(raw: unknown): Record<string, unknown>;
    private memory;
    policy(raw: unknown): Record<string, unknown>;
    private access;
    private current;
    private reference;
    create(raw: unknown): TaskController;
    resume(id: string): TaskController;
    private wrap;
    forExtension(authorize: (c: Conversation, context?: ActionContext) => ObservationAuthority, assertActive: () => void): TaskPluginAPI;
}
