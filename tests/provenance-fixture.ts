import { randomUUID,createHash } from 'node:crypto';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { SessionId } from '@deepseek-ai/dsh-session';
import { redactContent,redactJson } from '@dafeiyu/contracts';
import type { OperationScope } from '@dafeiyu/contracts';
import { MemoryStore } from '@dafeiyu/memory/store';
import type { MemoryView } from '@dafeiyu/memory/store';
import { memoryFixture } from './memory-fixture.js';
import { call,textReply } from './harness.js';
import type { Config as MemoryConfig } from '@dafeiyu/memory';

export async function provenanceFixture(root?:string,inputTokens=1000000,overrides:Partial<NonNullable<MemoryConfig['compaction']>>={}){
  const h=await memoryFixture(root,{compaction:{inputTokens,cooldownMs:0,minGrowthTokens:0,minSavingsTokens:64,retainTurns:1,maxSummaryChars:400,...overrides},context:{},});
  const store=new MemoryStore(join(h.root,'memory.sqlite'));
  const scopeFor=(route:string):OperationScope=>({agentId:'dafeiyu',route,traceId:'fictional-local-write',operationId:randomUUID(),startedEventId:randomUUID()});
  const run=async(text:string,reply='虚构回复',room='a')=>{
    h.setResponse(()=>textReply(reply));const receipt=h.simulator.send(room,text,{id:randomUUID()});await h.core.whenIdle();
    const item=h.core.journal.get(receipt.id);assert.equal(item.state,'delivered');return item;
  };
  const invoke=async(name:string,args:Record<string,unknown>,room='a',reply='虚构操作完成')=>{
    let requests=0;h.setResponse(()=>++requests===1?call(name,args):textReply(reply));
    const receipt=h.simulator.send(room,`执行虚构测试 ${name}`,{id:randomUUID()});await h.core.whenIdle();
    const item=h.core.journal.get(receipt.id);assert.equal(item.state,'delivered');return item;
  };
  const remember=async(text:string,room='a',parent?:MemoryView)=>{
    const evidence=await h.evidence(room,text),scope=scopeFor(evidence.message.route),m=evidence.message.message;
    const hash=createHash('sha256').update(redactContent(JSON.stringify(redactJson({sender:m.sender,occurredAt:m.occurredAt,text:m.text}).value,null,2)).value).digest('hex');
    const result=store.mutate(scope,{action:'create',requestId:randomUUID(),value:{kind:'knowledge',claimType:'self_report',content:text,
      sources:parent?[{kind:'memory',id:parent.id,revision:parent.revision,contentHash:parent.contentHash}]:[{kind:'timeline',ref:evidence.ref,contentHash:hash}]}});
    return {scope,evidence,memory:store.read(scope,result.id)!};
  };
  const rememberUnseen=(text:string,template:Awaited<ReturnType<typeof remember>>)=>{
    const message={...template.evidence.message.message,id:randomUUID(),text};
    const receipt=h.core.journal.accept('dafeiyu','channel-simulator','test',message),item=h.core.journal.get(receipt.id);
    const anchor=h.core.journal.events(item.route).find(e=>e.type==='message.accepted'&&e.traceId===receipt.id)!;
    const hash=createHash('sha256').update(redactContent(JSON.stringify(redactJson({sender:message.sender,occurredAt:message.occurredAt,text:message.text}).value,null,2)).value).digest('hex');
    return store.mutate(template.scope,{action:'create',requestId:randomUUID(),value:{kind:'knowledge',claimType:'observation',content:text,sources:[{kind:'timeline',ref:`dafeiyu:source:${anchor.id}:0`,contentHash:hash}]}});
  };
  return {...h,store,scopeFor,run,invoke,remember,rememberUnseen,
    select:async(items:MemoryView[],version:number,room='a')=>invoke('dafeiyu_memory_context_select',{requestId:randomUUID(),expectedVersion:String(version),taskId:'fictional-evidence',
      expiresAt:new Date(Date.now()+600000).toISOString(),items:JSON.stringify(items.map(m=>({id:m.id,revision:m.revision,version:m.version,contentHash:m.contentHash,start:0,end:Array.from(m.content).length})))},room),
    mutate:(value:Awaited<ReturnType<typeof remember>>,action:'delete'|'restore',version:number)=>store.mutate(value.scope,{action,id:value.memory.id,expectedVersion:version,requestId:randomUUID(),reason:'虚构本机测试'}),
    session:()=>{const item=h.core.journal.list(['delivered']).find(i=>i.message.conversation.id==='a');assert.ok(item);return h.ctx.agents.get(SessionId(item.sessionId))!.session;},
    visible:()=>JSON.stringify(h.adapter.requests.findLast(r=>r.purpose!=='compaction')?.messages),
    close:async()=>{store.close();await h.close();},
  };
}
