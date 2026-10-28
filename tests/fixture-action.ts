import {z} from 'zod';
import type {ActionCapability,ConversationAccess} from '@dafeiyu/contracts';
import type {DafeiyuService} from '@dafeiyu/core';

/** Typed fixture capability; uses the same authenticated invocation path as production tools. */
export function fixtureAction(core:DafeiyuService,owner:string,definition:{id:string;description:string;inputSchema:z.ZodType;
  work:(args:Readonly<Record<string,string>>,access:ConversationAccess)=>unknown|Promise<unknown>}):ActionCapability {
  return {id:definition.id,description:definition.description,version:'1',effects:'local-write',inputSchema:definition.inputSchema,outputSchema:z.json(),
    execute:async(input,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],
      data:z.json().parse(await definition.work(z.record(z.string(),z.string()).parse(input),core.conversationAccess(context,owner)))})};
}
