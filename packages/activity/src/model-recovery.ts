import type {Context} from '@deepseek-ai/cordis';
import {randomUUID} from 'node:crypto';
import {RecoveryProbeRequestSchema} from '@dafeiyu/contracts';
import type {RecoveryProbeRequest} from '@dafeiyu/contracts';
import type {ActivityStore} from './store.js';
import type {ModelRecoveryProbe} from './recovery-store.js';

export const MODEL_GATE='idle.model';
export function recoverableModelFailure(code:string|null){return !!code&&/^MODEL_(HTTP_(401|402|403|429|500|502|503|504)|TRANSPORT|CONNECTION_ERROR|NETWORK_ERROR|TIMEOUT|MESSAGES_IDLE|STREAM_CLOSED|INCOMPLETE)$/.test(code);}
export function accountModelFailure(code:string){return /^MODEL_HTTP_(401|402|403)$/.test(code);}

/** Successful calls can recover only the failure generation present when that call began. */
export class ActivityModelRecovery {
  private readonly cancel=new AbortController();
  private readonly unbind:()=>void;
  private active:Promise<ModelRecoveryProbe>|undefined;
  constructor(private readonly ctx:Context,private readonly store:ActivityStore,private readonly now:()=>number){
    store.recovery.interruptProbes(now());
    const route=ctx.dafeiyu.analysisModelRoute();
    this.unbind=ctx.root.on('llm/stream',async function*(options,next){
      const gate=options.provider===route.provider&&options.model===route.model?store.admission.gate(MODEL_GATE):null;
      let okay=false;
      for await(const chunk of next()){if(chunk.type==='finish')okay=!['error','aborted','max-tokens'].includes(chunk.reason.kind);yield chunk;}
      if(okay&&gate&&gate.reason!=='restored')store.admission.restore(MODEL_GATE,gate.generation,now());
    },{global:true});
  }
  status(){return {gate:this.store.admission.gate(MODEL_GATE),probing:!!this.active,probes:this.store.recovery.probes().slice(0,20),work:this.store.recovery.list().slice(-40)};}
  startProbe(input:RecoveryProbeRequest){void this.probe(input).catch(()=>{});return this.store.recovery.probe(input.requestId)??this.store.recovery.probes()[0]!;}
  schedule(now:number){
    const gate=this.store.admission.gate(MODEL_GATE);
    if(this.active||!gate||gate.reason==='restored'||gate.until===null||now<gate.until||!recoverableModelFailure(gate.reason))return;
    const attempts=this.store.recovery.probes().filter(p=>p.generation===gate.generation);
    if(attempts.length>=3){this.store.admission.postpone(MODEL_GATE,gate.generation,null,now);return;}
    const latest=this.store.recovery.probes()[0],eligible=latest?(latest.finishedAt??latest.startedAt)+Math.max(60000,this.store.config.backoffBaseMs):0;
    if(now<eligible){this.store.admission.postpone(MODEL_GATE,gate.generation,eligible,now);return;}
    void this.probe({requestId:randomUUID(),expectedGeneration:gate.generation},true).catch(()=>{});
  }
  probe(raw:RecoveryProbeRequest,automatic=false):Promise<ModelRecoveryProbe>{
    const input=RecoveryProbeRequestSchema.parse(raw),old=this.store.recovery.probe(input.requestId);
    if(old){if(old.generation!==input.expectedGeneration)throw new Error('IDEMPOTENCY_CONFLICT');return old.state==='running'&&this.active?this.active:Promise.resolve(old);}
    const now=this.now(),gate=this.store.admission.gate(MODEL_GATE);
    if(!gate||gate.generation!==input.expectedGeneration||gate.reason==='restored')throw new Error('ACTIVITY_RECOVERY_STALE');
    if(this.active){if(this.store.recovery.probes().find(p=>p.state==='running')?.generation!==input.expectedGeneration)throw new Error('ACTIVITY_RECOVERY_STALE');return this.active;}
    const latest=this.store.recovery.probes()[0],cooldown=Math.max(60000,this.store.config.backoffBaseMs);
    if(latest&&now<(latest.finishedAt??latest.startedAt)+cooldown)throw new Error('ACTIVITY_PROBE_COOLDOWN');
    const probe:ModelRecoveryProbe={id:input.requestId,generation:gate.generation,automatic,startedAt:now,finishedAt:null,state:'running',code:null};
    this.store.recovery.saveProbe(probe);
    const signal=AbortSignal.any([this.cancel.signal,AbortSignal.timeout(30000)]);
    const running=Promise.resolve().then(()=>this.ctx.dafeiyu.probeModelRecovery(probe.id,signal)).then(result=>{
      const at=this.now(),current=this.store.admission.gate(MODEL_GATE);
      const same=current?.generation===probe.generation,restored=current?.generation===probe.generation+1&&current.reason==='restored';
      const state=result.okay&&(same||restored)?'succeeded':!same&&!restored?'stale':signal.aborted?'interrupted':'failed';
      if(result.okay&&same)this.store.admission.restore(MODEL_GATE,probe.generation,at);
      if(!result.okay&&same){const attempts=this.store.recovery.probes().filter(p=>p.generation===probe.generation).length;
        this.store.admission.postpone(MODEL_GATE,probe.generation,accountModelFailure(result.code)||attempts>=3?null:at+Math.min(this.store.config.maxBackoffMs,cooldown*2**attempts),at);}
      const settled:ModelRecoveryProbe={...probe,state,finishedAt:at,code:result.okay?null:result.code};this.store.recovery.saveProbe(settled);return settled;
    }).catch(()=>{const settled:ModelRecoveryProbe={...probe,state:'interrupted',finishedAt:this.now(),code:'ACTIVITY_PROBE_INTERRUPTED'};this.store.recovery.saveProbe(settled);return settled;}).finally(()=>{if(this.active===running)this.active=undefined;});
    this.active=running;return running;
  }
  async close(){this.cancel.abort();this.unbind();await this.active;}
}
