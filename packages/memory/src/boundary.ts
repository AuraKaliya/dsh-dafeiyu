import { MemoryBoundarySchema,MemoryBoundaryPolicySchema,MemoryWriteBindingSchema,ConversationSchema,conversationKey } from '@dafeiyu/contracts';
import type { MemoryBoundary,MemoryBoundaryPolicy,MemoryWriteBinding,TimelineScope } from '@dafeiyu/contracts';
import { createHash } from 'node:crypto';

export const boundaryDigest=(value:MemoryBoundary)=>createHash('sha256').update(JSON.stringify(MemoryBoundarySchema.parse(value))).digest('hex');

/** Decode only the exact canonical route format. Opaque legacy routes stay opaque. */
function scene(scope:TimelineScope,binding:MemoryWriteBinding):MemoryBoundary['sourceScene'] {
  if(binding.conversation){
    if(conversationKey(scope.agentId,binding.conversation)!==scope.route)throw new Error('Memory scene does not match core scope');
    return {kind:'conversation',route:scope.route,conversation:binding.conversation,ingressPluginId:binding.ingressPluginId??null};
  }
  try{
    const parts:unknown=JSON.parse(scope.route);
    if(Array.isArray(parts)&&parts.length===5&&parts[0]===scope.agentId){
      const conversation=ConversationSchema.parse({channel:parts[1],account:parts[2],kind:parts[3],id:parts[4]});
      if(conversationKey(scope.agentId,conversation)===scope.route)return {kind:'conversation',route:scope.route,conversation,ingressPluginId:binding.ingressPluginId??null};
    }
  }catch{/* No guesses about channel, people or task membership during migration. */}
  return {kind:'legacy-route',route:scope.route};
}
export function conservativeBoundary(scope:TimelineScope,assignment:MemoryBoundary['assignment'],rawBinding:MemoryWriteBinding={}):MemoryBoundary {
  const binding=MemoryWriteBindingSchema.parse(rawBinding);
  return MemoryBoundarySchema.parse({schemaVersion:1,policyVersion:1,owner:{kind:'agent',agentId:scope.agentId},sourceScene:scene(scope,binding),
    task:binding.agentTaskId?{kind:'agent-task',id:binding.agentTaskId}:binding.taskId?{kind:'conversation-task',route:scope.route,id:binding.taskId}:{kind:'unassigned'},
    internalUse:{kind:'conversation',route:scope.route},externalExpression:{kind:'conversation',route:scope.route},assignment});
}
/** Sources and the previous head may narrow a new revision, never silently widen it. */
export function restrictBoundary(boundary:MemoryBoundary,ancestors:readonly MemoryBoundary[],rawPolicy:MemoryBoundaryPolicy={}):MemoryBoundary {
  const policy=MemoryBoundaryPolicySchema.parse(rawPolicy),result=structuredClone(boundary);
  for(const field of ['internalUse','externalExpression'] as const){
    const restricted=ancestors.some(b=>b[field].kind==='none');
    if(restricted&&policy[field]==='conversation')throw new Error('scope_expansion_not_supported');
    if(restricted||policy[field]==='none')result[field]={kind:'none'};
  }
  return MemoryBoundarySchema.parse(result);
}
