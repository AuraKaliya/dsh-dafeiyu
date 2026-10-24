import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TaskStateSchema, ExecutionInputSchema } from '@dafeiyu/contracts';
import type { TaskRepositoryPort } from '@dafeiyu/contracts';
import type { TaskWorkspace } from './task-workspace.js';
import { witnessSchema } from './task-workspace.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const viewSchema=z.object({task:TaskStateSchema,links:z.array(z.object({id:z.uuid(),proof:witnessSchema,valid:z.boolean(),text:z.string().optional()}))});
export function taskRepository(tasks:TaskWorkspace,agentId:string,available:()=>void,ready:()=>boolean,flush:()=>void,sourceIdentity:(route:string,ref:string)=>string|null=()=>null):TaskRepositoryPort {
  const check=(agent:string)=>{available();if(agent!==agentId)throw new Error('SCOPE_DENIED');};
  const readState=(agent:string,id:string)=>{check(agent);return viewSchema.parse(tasks.read(agent,id)).task;};
  return Object.freeze({ready,
    create(agent,input){check(agent);const id=tasks.create(agent,input);flush();return id;},
    findRequest(agent,requestId){check(agent);return tasks.findCreateRequest(agent,requestId);},readState,
    update(agent,id,input){check(agent);tasks.update(agent,id,input);flush();return readState(agent,id);},
    readSelectedInputs(agent,id,refs,sourceRules){check(agent);const view=viewSchema.parse(tasks.read(agent,id));
      if(new Set(refs).size!==refs.length)throw new Error('INVALID_INPUT');
      return refs.map(ref=>{const link=view.links.find(link=>`task-link:${link.id}`===ref),proof=link?.proof;
        // Only D1-selected memory bearing a still-current explicit rule may enter a native run.
        if(!link?.valid||link.text===undefined||proof?.kind!=='memory'||!proof.authorization||!sourceRules.includes(proof.authorization.policyId))throw new Error('SOURCE_STALE');
        return ExecutionInputSchema.parse({id:ref,scopeKey:proof.route,version:proof.version,contentHash:hash(link.text),text:link.text,
          proofHash:hash(JSON.stringify(proof)),kind:'selected-memory',sourceRef:{kind:'memory',id:proof.id,agentId:agent,scopeKey:proof.route,version:proof.version,revision:proof.revision,contentHash:proof.contentHash,
            authorization:proof.authorization,selectionId:link.id,...(proof.range?{range:proof.range}:{})},rootSources:[...new Set(proof.fences.map(fence=>JSON.stringify(['timeline',agent,proof.route,sourceIdentity(proof.route,fence.ref)??fence.ref])))]});
      });},
  } satisfies TaskRepositoryPort);
}
