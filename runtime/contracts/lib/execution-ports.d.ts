import { z } from 'zod';
import { TaskCreateSchema, TaskUpdateSchema } from './task-workspace.js';
import { RunOriginSchema } from './execution.js';
export declare const TaskStateSchema: z.ZodObject<{
    id: z.ZodUUID;
    agentId: z.ZodString;
    version: z.ZodNumber;
    epoch: z.ZodNumber;
    status: z.ZodEnum<{
        completed: "completed";
        active: "active";
        paused: "paused";
    }>;
    title: z.ZodString;
    goal: z.ZodString;
}, z.core.$strict>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export declare const ExecutionInputSchema: z.ZodObject<{
    id: z.ZodString;
    scopeKey: z.ZodString;
    version: z.ZodNumber;
    contentHash: z.ZodString;
    text: z.ZodString;
    proofHash: z.ZodString;
    kind: z.ZodEnum<{
        "selected-memory": "selected-memory";
        "execution-source": "execution-source";
    }>;
    sourceRef: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    rootSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type ExecutionInput = z.infer<typeof ExecutionInputSchema>;
/** Native repository access never manufactures a conversation or a v2 work ticket. */
export interface TaskRepositoryPort {
    ready(): boolean;
    create(agentId: string, input: z.output<typeof TaskCreateSchema>): string;
    findRequest(agentId: string, requestId: string): string | null;
    readState(agentId: string, taskId: string): TaskState;
    readSelectedInputs(agentId: string, taskId: string, refs: readonly string[], sourceRules: readonly string[]): ExecutionInput[];
    update(agentId: string, taskId: string, input: z.output<typeof TaskUpdateSchema>): TaskState;
}
export interface TaskRef {
    readonly id: string;
}
export interface RunRef {
    readonly id: string;
}
export declare const ExistingTaskRequestSchema: z.ZodObject<{
    requestId: z.ZodString;
    policyId: z.ZodString;
    inputRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    data: z.ZodOptional<z.ZodJSONSchema>;
    taskId: z.ZodUUID;
    expectedVersion: z.ZodNumber;
}, z.core.$strict>;
export declare const ExecutionRequestSchema: z.ZodUnion<readonly [z.ZodObject<{
    requestId: z.ZodString;
    title: z.ZodString;
    goal: z.ZodString;
    policyId: z.ZodString;
    inputRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    data: z.ZodOptional<z.ZodJSONSchema>;
}, z.core.$strict>, z.ZodObject<{
    requestId: z.ZodString;
    policyId: z.ZodString;
    inputRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    data: z.ZodOptional<z.ZodJSONSchema>;
    taskId: z.ZodUUID;
    expectedVersion: z.ZodNumber;
}, z.core.$strict>]>;
export declare const RunControlSchema: z.ZodObject<{
    requestId: z.ZodString;
    expectedVersion: z.ZodNumber;
    reason: z.ZodString;
}, z.core.$strict>;
export declare const ResumeRunSchema: z.ZodObject<{
    requestId: z.ZodString;
    policyId: z.ZodString;
    inputRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    data: z.ZodOptional<z.ZodJSONSchema>;
    taskId: z.ZodUUID;
    expectedVersion: z.ZodNumber;
    parentRunId: z.ZodUUID;
    checkpointId: z.ZodUUID;
}, z.core.$strict>;
export declare const WakeRequestSchema: z.ZodObject<{
    requestId: z.ZodString;
    policyId: z.ZodString;
    inputRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    data: z.ZodOptional<z.ZodJSONSchema>;
    taskId: z.ZodUUID;
    expectedVersion: z.ZodNumber;
    origin: z.ZodObject<{
        kind: z.ZodLiteral<"wake">;
        producerId: z.ZodString;
        scheduleId: z.ZodString;
        scheduleVersion: z.ZodNumber;
        occurrenceId: z.ZodString;
        dueAt: z.ZodISODateTime;
    }, z.core.$strict>;
}, z.core.$strict>;
/** Trusted wake purpose; it describes this run without changing its task or authority. */
export declare const WakeWorkSchema: z.ZodObject<{
    kind: z.ZodLiteral<"memory-maintenance">;
    requestId: z.ZodUUID;
    goal: z.ZodString;
}, z.core.$strict>;
export interface WakeAuthorityProvider {
    readonly producerId: string;
    validate(origin: Extract<z.infer<typeof RunOriginSchema>, {
        kind: 'wake';
    }>, task: TaskState): boolean;
    sourceAnchor?(origin: Extract<z.infer<typeof RunOriginSchema>, {
        kind: 'wake';
    }>, task: TaskState): import('./activity.js').ActivityAnchor | null;
    work?(origin: Extract<z.infer<typeof RunOriginSchema>, {
        kind: 'wake';
    }>, task: TaskState): z.infer<typeof WakeWorkSchema> | null;
}
export declare const ProducerSchema: z.ZodString;
