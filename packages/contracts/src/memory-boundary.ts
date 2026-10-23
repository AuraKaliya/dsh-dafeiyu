import { z } from 'zod';
import type { TimelineScope } from './history.js';

const id=z.string().min(1).max(160),route=z.string().min(1).max(2000);
const conversation=z.strictObject({channel:id,account:id,kind:z.enum(['private','group','local']),id});
const range=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('conversation'),route}),z.strictObject({kind:z.literal('none')}),
]);
/** Stage A deliberately provides no agent-wide/public grant constructor. Ownership is
 * independent of permission, and matching a task name never grants access. */
export const MemoryBoundarySchema=z.strictObject({
  schemaVersion:z.literal(1),policyVersion:z.literal(1),owner:z.strictObject({kind:z.literal('agent'),agentId:id}),
  sourceScene:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('conversation'),route,conversation,ingressPluginId:id.nullable()}),
    z.strictObject({kind:z.literal('legacy-route'),route}),
  ]),
  task:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('unassigned')}),
    z.strictObject({kind:z.literal('conversation-task'),route,id:z.string().min(1).max(100)}),
    z.strictObject({kind:z.literal('agent-task'),id:z.uuid()}),
  ]),
  internalUse:range,externalExpression:range,
  assignment:z.enum(['legacy-migration','conservative-create']),
});
export type MemoryBoundary=z.infer<typeof MemoryBoundarySchema>;
export type MemoryAccessPurpose='internal'|'expression';
export const MemoryBoundaryPolicySchema=z.strictObject({internalUse:z.enum(['conversation','none']).optional(),externalExpression:z.enum(['conversation','none']).optional()});
export type MemoryBoundaryPolicy=z.infer<typeof MemoryBoundaryPolicySchema>;
/** Trusted call-site metadata, never accepted from model tool arguments. */
export const MemoryWriteBindingSchema=z.strictObject({conversation:conversation.optional(),ingressPluginId:id.optional(),taskId:z.string().min(1).max(100).nullable().optional(),agentTaskId:z.uuid().optional()});
export type MemoryWriteBinding=z.infer<typeof MemoryWriteBindingSchema>;
export function boundaryAllows(boundary:MemoryBoundary,scope:TimelineScope,purpose:MemoryAccessPurpose):boolean {
  const matches=(range:MemoryBoundary['internalUse'])=>range.kind==='conversation'&&range.route===scope.route;
  return boundary.owner.agentId===scope.agentId&&matches(boundary.internalUse)&&(purpose==='internal'||matches(boundary.externalExpression));
}
