import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import type { Conversation } from './conversation.js';
import type { ActionContext } from './index.js';
import type { MemoryObservation,ObservationAuthority,ObservationReceipt } from './observation.js';
import type { TimelineScope } from './history.js';
import type { TaskMemoryControl } from './task-memory.js';
import type { TaskExpressionControl } from './expression.js';

const key=z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),version=z.number().int().nonnegative();
export const TaskCreateSchema=z.strictObject({requestId:key,title:z.string().min(1).max(200),goal:z.string().min(1).max(2000)});
export const TaskUpdateSchema=z.strictObject({requestId:key,expectedVersion:version,title:z.string().min(1).max(200).optional(),goal:z.string().min(1).max(2000).optional(),status:z.enum(['active','paused','completed']).optional()})
  .refine(v=>v.title!==undefined||v.goal!==undefined||v.status!==undefined,'Empty task update');
export const TaskSceneSchema=z.strictObject({requestId:key,conversation:ConversationSchema});
export const TaskActivateSchema=TaskSceneSchema.extend({expectedVersion:version});
export const TaskLinkSchema=TaskSceneSchema.extend({expectedVersion:version,items:z.array(z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('memory'),id:z.uuid(),revision:z.number().int().positive(),version:z.number().int().positive(),contentHash:z.string().length(64)}),
  z.strictObject({kind:z.literal('observation'),id:z.uuid()}),
])).min(1).max(8)});
export const TaskBeginSchema=TaskSceneSchema.extend({slot:key,expectedSlotVersion:version,inputs:z.array(z.uuid()).max(16)});
export const TaskCompleteSchema=z.strictObject({requestId:key,text:z.string().min(1).max(4000)});
/** These identities are opaque core capabilities. A serialized id is not authority. */
export interface TaskReference {readonly id:string}
export interface TaskWorkTicket {readonly id:string}
export interface TaskController {readonly reference:TaskReference;readonly memory:TaskMemoryControl;readonly expression:TaskExpressionControl;read():Record<string,unknown>;update(input:unknown):Record<string,unknown>}
export interface TaskPluginAPI {
  join(task:TaskReference,input:unknown,context?:ActionContext):Record<string,unknown>;
  activate(task:TaskReference|null,input:unknown,context?:ActionContext):Record<string,unknown>;
  link(task:TaskReference,input:unknown,context?:ActionContext):Record<string,unknown>;
  begin(task:TaskReference,input:unknown,context?:ActionContext):TaskWorkTicket;
  observe(ticket:TaskWorkTicket,input:unknown):ObservationReceipt;
  complete(ticket:TaskWorkTicket,input:unknown):Record<string,unknown>;
  view(task:TaskReference,conversation:Conversation,context?:ActionContext):Record<string,unknown>;
}
export interface TaskWorkspaceProvider {
  current(scope:TimelineScope):string|null;
  create(agentId:string,input:z.output<typeof TaskCreateSchema>):string;
  read(agentId:string,id:string):Record<string,unknown>;
  update(agentId:string,id:string,input:z.output<typeof TaskUpdateSchema>):Record<string,unknown>;
  join(authority:ObservationAuthority,id:string,input:z.output<typeof TaskSceneSchema>):Record<string,unknown>;
  activate(authority:ObservationAuthority,id:string|null,input:z.output<typeof TaskActivateSchema>):Record<string,unknown>;
  link(authority:ObservationAuthority,id:string,input:z.output<typeof TaskLinkSchema>):Record<string,unknown>;
  begin(authority:ObservationAuthority,id:string,input:z.output<typeof TaskBeginSchema>):string;
  observe(authority:ObservationAuthority,jobId:string,input:MemoryObservation):ObservationReceipt;
  complete(authority:ObservationAuthority,jobId:string,input:z.output<typeof TaskCompleteSchema>):Record<string,unknown>;
  view(authority:ObservationAuthority,id:string):Record<string,unknown>;
}
