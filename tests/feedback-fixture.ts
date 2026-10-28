import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { z } from 'zod';
import { API_VERSION } from '@dafeiyu/contracts';
import type { Json,ToolFeedback,ConversationAccess } from '@dafeiyu/contracts';
import { call,textReply } from './harness.js';
import { memoryFixture } from './memory-fixture.js';

export type FeedbackHarness=Awaited<ReturnType<typeof memoryFixture>>;
export const report=(data:Json='虚构工具输出',extra:Partial<ToolFeedback>={}):ToolFeedback=>({schemaVersion:1,outcome:'succeeded',effects:'none',completeness:'complete',
  resourceVersion:'fictional-resource-v1',summary:'虚构查询完成',diagnostics:[],receipts:['FICTIONAL-RECEIPT'],sourceRefs:[],data,...extra});
export function fixtureTool(h:FeedbackHarness,work:(context:ConversationAccess)=>Promise<Json>|Json,adapted=true){
  let calls=0;const name=`fixture_${randomUUID().replaceAll('-','')}`;
  const handle=h.core.registerExtension({id:name.replaceAll('_','-'),version:'fixture-v1',agentId:'dafeiyu',protocolVersion:4,actions:[{
    name,description:'虚构工具反馈验收',fields:{},...(adapted?{feedback:'structured-v1' as const}:{}),execute:async(_args,context)=>{calls++;return work(context);},
  }]});
  return {name,handle,get calls(){return calls;}};
}
export async function invoke(h:FeedbackHarness,name:string,args:Record<string,string>={},room='a'){
  let step=0;h.setResponse(()=>++step===1?call(name,args):textReply('虚构步骤完成'));
  const receipt=h.simulator.send(room,'执行虚构反馈验收',{id:randomUUID()});await h.core.whenIdle();
  const message=h.core.journal.get(receipt.id),agent=h.ctx.agents.get(SessionId(message.sessionId))!;
  assert.equal(message.state,'delivered','Fixture turn must reach the intended tool result');
  const called=agent.session.snapshotEvents().findLast(e=>e.type==='tool/call');assert.ok(called&&called.type==='tool/call');
  const event=agent.session.snapshotEvents().findLast(e=>e.type==='tool/result'&&e.data.message.toolCallId===called.data.callId);assert.ok(event&&event.type==='tool/result');
  const text=event.data.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  return {value:z.json().parse(JSON.parse(text)),text,event,message,agent};
}
export const archivePointer=(value:unknown)=>z.object({archive:z.object({ref:z.string(),version:z.number(),hash:z.string()})}).parse(value).archive;
export async function nextTurn(h:FeedbackHarness,room='a'){
  h.setResponse(()=>textReply('新的虚构回合'));const receipt=h.simulator.send(room,'继续',{id:randomUUID()});await h.core.whenIdle();return h.core.journal.get(receipt.id);
}
