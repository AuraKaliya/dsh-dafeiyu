import { z } from 'zod';
import { TaskCreateSchema, TaskUpdateSchema } from './task-workspace.js';
import { ExtensionIdSchema, RunOriginSchema, TaskSubmitSchema, WakeOriginSchema } from './execution.js';

export const TaskStateSchema = z.strictObject({ id:z.uuid(),agentId:z.string().min(1),version:z.number().int().positive(),
  epoch:z.number().int().positive(),status:z.enum(['active','paused','completed']),title:z.string().max(200),goal:z.string().max(2000) });
export type TaskState = z.infer<typeof TaskStateSchema>;
export const ExecutionInputSchema = z.strictObject({ id:z.string().min(1).max(300),scopeKey:z.string().min(1).max(2000),
  version:z.number().int().positive(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),text:z.string().max(32000),
  proofHash:z.string().regex(/^[a-f0-9]{64}$/),kind:z.enum(['selected-memory','execution-source']) });
export type ExecutionInput = z.infer<typeof ExecutionInputSchema>;
/** Native repository access never manufactures a conversation or a v2 work ticket. */
export interface TaskRepositoryPort {
  ready():boolean;
  create(agentId:string,input:z.output<typeof TaskCreateSchema>):string;
  findRequest(agentId:string,requestId:string):string|null;
  readState(agentId:string,taskId:string):TaskState;
  readSelectedInputs(agentId:string,taskId:string,refs:readonly string[],sourceRules:readonly string[]):ExecutionInput[];
  update(agentId:string,taskId:string,input:z.output<typeof TaskUpdateSchema>):TaskState;
}
export interface TaskRef { readonly id:string }
export interface RunRef { readonly id:string }
export const ExistingTaskRequestSchema = TaskSubmitSchema.omit({title:true,goal:true}).extend({taskId:z.uuid(),expectedVersion:z.number().int().positive()});
export const ExecutionRequestSchema = z.union([TaskSubmitSchema,ExistingTaskRequestSchema]);
export const RunControlSchema = z.strictObject({requestId:z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),expectedVersion:z.number().int().positive(),reason:z.string().min(1).max(300)});
export const ResumeRunSchema = ExistingTaskRequestSchema.extend({parentRunId:z.uuid(),checkpointId:z.uuid()});
export const WakeRequestSchema = ExistingTaskRequestSchema.extend({origin:WakeOriginSchema});
export interface WakeAuthorityProvider {
  readonly producerId:string;
  validate(origin:Extract<z.infer<typeof RunOriginSchema>,{kind:'wake'}>,task:TaskState):boolean;
}
export const ProducerSchema=ExtensionIdSchema;
