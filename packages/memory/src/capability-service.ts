import type { Context } from '@deepseek-ai/cordis';
import type { MemoryStore } from './store.js';
import type { MemorySourcePolicy } from './source-policy.js';
import { conversationKey } from '@dafeiyu/contracts';

export class CapabilityObservationService {
  private readonly unbind:()=>void;
  private readonly unvalidate:()=>void;
  constructor(ctx:Context,memory:MemoryStore,ready:()=>boolean,sourcePolicy:MemorySourcePolicy,flush:()=>unknown) {
    this.unvalidate=memory.capabilities.bind((scope,body,access)=>{
      if(!ready()||!ctx.dafeiyu.capabilityResourceCurrent(body.proof))return false;
      if(body.scope.kind==='task') {
        if(!access||access.view.scope.kind!=='task'||access.view.scope.scopeKey!==scope.route||!access.resourceAllowed?.(body.proof.scene))return false;
        return !body.history.length||!!access.validateHistory?.(body.history);
      }
      if(conversationKey(scope.agentId,body.proof.scene)!==scope.route)return false;
      return body.history.every(dep=>dep.kind==='context'?ctx.dafeiyu.capabilityHistoryCurrent(scope,[dep]):sourcePolicy.validate({...scope,traceId:body.origin.kind==='message'?body.origin.inboundId:body.runId},dep));
    });
    this.unbind=ctx.dafeiyu.bindCapabilityObservations({ready,
      record:(access,input)=>{try{return memory.capabilities.record(access,input);}finally{flush();}},
      select:(access,input,text)=>{try{return memory.capabilities.select(access,input,text);}finally{flush();}},
      valid:(scope,source,exposedHash)=>memory.capabilities.valid(scope,source,exposedHash),
    });
  }
  close(){this.unbind();this.unvalidate();}
}
