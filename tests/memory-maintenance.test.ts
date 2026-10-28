import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ExecutionContext,PersonaSourceRef,MaintenanceAnalysis } from '@dafeiyu/contracts';
import { executionHarness } from './execution-fixture.js';
import { testTempDir } from './test-temp.js';
import { call,textReply } from './harness.js';

type H=Awaited<ReturnType<typeof executionHarness>>;
const observation={requestId:'observe',occurredAt:'2026-10-25T00:00:00.000Z',text:'虚构蓝灯在雨天失败，晴天尚未测试。',kind:'primary',resource:'fixture:blue',coverage:['fictional-rain-test'],completeness:'partial'};
const counter='虚构红灯在相同雨天成功，仅此一次。';
const analysis=():MaintenanceAnalysis=>({schemaVersion:1,summary:'雨天样本存在差异',gaps:['只有虚构的单次实验'],
  experiences:[{content:{observation:'蓝灯雨天失败，红灯成功',action:'比较蓝灯和红灯',outcome:'两份来源结果不同',interpretation:'应继续比较而不直接固定规则',conditions:['仅这一次雨天测试'],unknowns:['晴天尚未测试']},
    supports:[{sourceId:'S1',quote:observation.text}],counters:[{sourceId:'S2',quote:counter}],target:null}],
  relations:[{kind:'counters',from:{sourceId:'S1',quote:observation.text},to:{sourceId:'S2',quote:counter},reason:'条件接近但结果有差异'}],
  persona:[{kind:'interest',text:'我想继续研究灯具在雨中的表现',applicability:'暂时好奇',reason:'存在未解问题',supports:[{sourceId:'S1',quote:observation.text}],counters:[]}]});
const dbRead=(root:string,sql:string)=>{const db=new DatabaseSync(join(root,'memory/memory.sqlite'),{readOnly:true});try{return db.prepare(sql).all();}finally{db.close();}};
async function fixture(options:{reply?:()=>Promise<MaintenanceAnalysis>|MaintenanceAnalysis;motivation?:'self-exploration'|'explicit-task';after?:(h:H,c:ExecutionContext,id:string)=>unknown;timeoutMs?:number;maxInputBytes?:number;maxOutputBytes?:number;longSource?:boolean}={}){
  const root=await mkdtemp(join(testTempDir(),'maintenance-flow-'));let h:H,step=0,id='',refs:PersonaSourceRef[]=[];
  const execute=async(c:ExecutionContext)=>{
    if(step===1){refs=[h.memory.growth!.recordObservation(c,{...observation,text:observation.text+(options.longSource?'额外虚构记录。'.repeat(700):'')},'fixture'),h.memory.growth!.recordObservation(c,{...observation,requestId:'counter',text:counter,resource:'fixture:red'},'fixture')];return refs;}
    if(step===2){id=h.memory.maintenance!.request(c,{requestId:'maintain',sources:refs,reason:'比较本任务的虚构经历'},'fixture').id;return {id};}
    if(step===3)return h.memory.maintenance!.consolidate(c,id,'fixture');
    return options.after?.(h,c,id)??h.memory.maintenance!.inspect(c,id,'fixture');
  };
  const extension={id:'fixture',version:'1',actions:[{id:'fixture_maintain',version:'1',description:'fictional maintenance operation',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write' as const,
    execute:async(_input:unknown,c:ExecutionContext)=>({status:'succeeded' as const,effects:'confirmed' as const,completeness:'complete' as const,data:z.json().parse(await execute(c)),sources:[],receipts:[]})}]};
  h=await executionHarness(root,async request=>{
    if(JSON.stringify(request).includes('独立经历分析器'))return textReply(JSON.stringify(await(options.reply?.()??analysis())));
    return ++step<=4?call('fixture_maintain',{}):textReply('虚构整理结束');
  },extension,true,{maintenance:{...(options.timeoutMs?{timeoutMs:options.timeoutMs}:{}),...(options.maxInputBytes?{maxInputBytes:options.maxInputBytes}:{}),...(options.maxOutputBytes?{maxOutputBytes:options.maxOutputBytes}:{})}});
  return {root,h,refs:()=>refs,id:()=>id,setStep:(value:number)=>{step=value;},run:async()=>{
    const port=h.core.executionProducer('local-test',{motivation:{kind:options.motivation??'explicit-task',basis:['fictional-only']}}),accepted=port.submitTask({requestId:'start',title:'测试',goal:'比较虚构灯具',policyId:'test-policy'});
    await h.core.whenIdle();return {port,accepted,status:port.status(accepted.run)};
  }};
}

test('native consolidation uses isolated DSH, keeps counters and motivation, and does not adopt personality',async()=>{
  let report:unknown;const f=await fixture({after:(h,c,id)=>{report=h.memory.maintenance!.inspect(c,id,'fixture');return report;}});
  try{f.h.ctx.systemPrompt.section({name:'foreign',order:0,text:'UNRELATED_PROMPT_SENTINEL'});const run=await f.run();assert.equal(run.status.state,'completed');
    const result=z.object({experienceIds:z.array(z.uuid()),persona:z.array(z.object({eligible:z.boolean(),holdReason:z.string().nullable()}))}).parse(report);
    assert.equal(result.experienceIds.length,1);assert.equal(result.persona[0]?.eligible,false);assert.equal(result.persona[0]?.holdReason,'TASK_MOTIVATION_NOT_PREFERENCE');
    const row=JSON.parse(String(dbRead(f.root,'SELECT body FROM experience_revisions')[0]!.body));assert.equal(row.counters.length,1);assert.equal(row.motivation.kind,'explicit-task');assert.equal(row.state,'proposed');
    assert.equal(dbRead(f.root,'SELECT * FROM persona_profiles').length,0);
    const request=f.h.adapter.requests.find(r=>JSON.stringify(r).includes('独立经历分析器'))!;assert.ok(request);assert.ok(!JSON.stringify(request).includes('UNRELATED_PROMPT_SENTINEL'));
    assert.ok((await readdir(join(f.root,'memory/maintenance-sessions'))).length>0);assert.equal(dbRead(f.root,'SELECT * FROM maintenance_watermarks').length,1);
  }finally{await f.h.close();}
});

test('a self-exploration suggestion can be explicitly proposed, but remains unadopted',async()=>{
  const f=await fixture({motivation:'self-exploration',after:(h,c,id)=>h.memory.maintenance!.propose(c,{id,index:0,requestId:'choose'},'fixture')});
  try{const run=await f.run();assert.equal(run.status.state,'completed');assert.equal(dbRead(f.root,'SELECT state FROM persona_candidates')[0]?.state,'proposed');assert.equal(dbRead(f.root,'SELECT * FROM persona_profiles').length,0);}
  finally{await f.h.close();}
});

test('fabricated citation fails the entire analysis without committing experience or candidate',async()=>{
  const f=await fixture({reply:()=>{const value=analysis();value.experiences[0]!.supports[0]!.quote='根本不存在的原文';return value;}});
  try{await f.run();assert.equal(dbRead(f.root,'SELECT * FROM experience_items').length,0);assert.equal(dbRead(f.root,'SELECT * FROM persona_candidates').length,0);
    assert.equal(dbRead(f.root,'SELECT error FROM maintenance_requests')[0]?.error,'INVALID_EVIDENCE');assert.equal(dbRead(f.root,'SELECT * FROM maintenance_watermarks').length,0);}
  finally{await f.h.close();}
});

test('source change while the model is running blocks commit and derived content',async()=>{
  const f=await fixture({reply:()=>{const db=new DatabaseSync(join(f.root,'memory/memory.sqlite'));try{db.exec('UPDATE execution_sources SET state_version=state_version+1');}finally{db.close();}return analysis();}});
  try{await f.run();assert.equal(dbRead(f.root,'SELECT * FROM experience_items').length,0);assert.equal(dbRead(f.root,'SELECT state FROM maintenance_requests')[0]?.state,'stale');}
  finally{await f.h.close();}
});

test('timeout records cancellation state without a watermark or automatic retry',async()=>{
  const f=await fixture({timeoutMs:100,reply:async()=>{await new Promise(resolve=>setTimeout(resolve,180));return analysis();}});
  try{await f.run();assert.equal(dbRead(f.root,'SELECT error FROM maintenance_requests')[0]?.error,'ANALYSIS_TIMEOUT');assert.equal(dbRead(f.root,'SELECT * FROM maintenance_watermarks').length,0);
    assert.equal(f.h.adapter.requests.filter(r=>JSON.stringify(r).includes('独立经历分析器')).length,1);}
  finally{await f.h.close();}
});

test('input budget rejects oversized analysis before starting an auxiliary model',async()=>{
  const f=await fixture({maxInputBytes:4096,longSource:true});try{await f.run();assert.equal(dbRead(f.root,'SELECT error FROM maintenance_requests')[0]?.error,'INPUT_TOO_LARGE');
    assert.equal(f.h.adapter.requests.filter(r=>JSON.stringify(r).includes('独立经历分析器')).length,0);}finally{await f.h.close();}
});

test('a failed final transaction rolls back generated sources and leaves original observations intact',async()=>{
  const f=await fixture({reply:()=>{const db=new DatabaseSync(join(f.root,'memory/memory.sqlite'));try{db.exec("CREATE TRIGGER injected BEFORE INSERT ON maintenance_watermarks BEGIN SELECT RAISE(ABORT,'injected'); END;");}finally{db.close();}return analysis();}});
  try{await f.run();assert.equal(dbRead(f.root,'SELECT * FROM execution_sources').length,2);assert.equal(dbRead(f.root,'SELECT * FROM experience_items').length,0);assert.equal(dbRead(f.root,'SELECT state FROM maintenance_requests')[0]?.state,'failed');}
  finally{await f.h.close();}
});

test('withdrawal invalidates experience content immediately and a foreign task cannot read the request',async()=>{
  let oldSource:PersonaSourceRef|undefined,requestId='';
  const f=await fixture({after:(h,c,id)=>{requestId=id;const result=z.object({experienceIds:z.array(z.uuid())}).parse(h.memory.maintenance!.inspect(c,id,'fixture'));
    const item=h.memory.maintenance!.read(c,result.experienceIds[0]!,'fixture');oldSource=item.contentRef;
    h.memory.maintenance!.review(c,{requestId:'withdraw',id:item.id,expectedVersion:1,state:'withdrawn',reason:'虚构复核发现缺口'},'fixture');
    assert.throws(()=>h.memory.maintenance!.read(c,item.id,'fixture'),/SOURCE_STALE/);
    assert.throws(()=>h.memory.maintenance!.inspect(c,id,'fixture'),/SOURCE_STALE/);return {withdrawn:true};}});
  try{await f.run();assert.ok(oldSource);assert.ok(requestId);assert.equal(dbRead(f.root,'SELECT state FROM experience_items')[0]?.state,'withdrawn');
    f.h.extensionHandle!.dispose();let checked=false;f.h.core.registerExtension({protocolVersion:4,id:'fixture',version:'1',agentId:'dafeiyu',actions:[{id:'fixture_maintain',version:'1',description:'foreign read',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write',execute:async(_i,c)=>{
      assert.throws(()=>f.h.memory.maintenance!.inspect(c,requestId,'fixture'),/SCOPE_DENIED/);checked=true;return {status:'succeeded',effects:'none',completeness:'complete',data:null,sources:[],receipts:[]};}}]});
    // A new scoped Run is checked through a trusted fixture action, without carrying an old grant.
    f.setStep(3);const other=f.h.port.submitTask({requestId:'other',title:'另一个任务',goal:'不能读取旧任务',policyId:'test-policy'});await f.h.core.whenIdle();
    assert.equal(f.h.port.status(other.run).state,'completed');
    assert.equal(checked,true);
  }finally{await f.h.close();}
});

test('new evidence revises a pinned experience version while preserving the old revision and counters',async()=>{
  const root=await mkdtemp(join(testTempDir(),'maintenance-revision-'));let h:H,step=0,round=0,id='',experienceId='',source:PersonaSourceRef;const readRounds:number[]=[];
  const extension={id:'fixture',version:'1',actions:[{id:'fixture_revise',version:'1',description:'experience comparison',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write' as const,
    execute:async(_i:unknown,c:ExecutionContext)=>{let data:unknown;
      if(step===1){source=h.memory.growth!.recordObservation(c,{...observation,requestId:`observe-${round}`,text:round?'新的虚构实验显示蓝灯经过密封后成功。':observation.text},'fixture');data=source;}
      else if(step===2){id=h.memory.maintenance!.request(c,{requestId:`request-${round}`,sources:[source],reason:'按实际新证据修订',targets:round?[{id:experienceId,version:1}]:[]},'fixture').id;data={id};}
      else if(step===3)data=await h.memory.maintenance!.consolidate(c,id,'fixture');
      else{const result=z.object({experienceIds:z.array(z.uuid())}).parse(h.memory.maintenance!.inspect(c,id,'fixture'));data=h.memory.maintenance!.read(c,result.experienceIds[0]!,'fixture');readRounds.push(round);}
      return {status:'succeeded' as const,effects:'confirmed' as const,completeness:'complete' as const,data:z.json().parse(data),sources:[],receipts:[]};}}]};
  h=await executionHarness(root,request=>{
    if(JSON.stringify(request).includes('独立经历分析器')){const value=analysis();
      const actual=z.object({sources:z.array(z.object({sourceId:z.string(),text:z.string()}))}).parse(JSON.parse(request.messages.at(-1)!.content.filter(b=>b.type==='text').map(b=>b.text).join('')));
      const support=actual.sources.find(s=>s.text===(round?'新的虚构实验显示蓝灯经过密封后成功。':observation.text))!;
      value.experiences[0]!.supports=[{sourceId:support.sourceId,quote:support.text}];
      value.experiences[0]!.counters=round?[{sourceId:actual.sources.find(s=>s.text===observation.text)!.sourceId,quote:observation.text}]:[];value.experiences[0]!.target=round?{id:experienceId,version:1}:null;
      value.persona=[];value.relations=[];return textReply(JSON.stringify(value));}
    return ++step<=4?call('fixture_revise',{}):textReply('测试结束');
  },extension,true,{maintenance:{}});
  try{const first=h.port.submitTask({requestId:'first',title:'虚构比较',goal:'验证两次实验',policyId:'test-policy'});await h.core.whenIdle();assert.equal(h.port.status(first.run).state,'completed');
    experienceId=String(dbRead(root,'SELECT id FROM experience_items')[0]!.id);round=1;step=0;
    const second=h.port.submitTask({requestId:'second',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();
    assert.equal(dbRead(root,'SELECT version FROM experience_items')[0]?.version,2,JSON.stringify(h.port.status(second.run)));
    assert.equal(dbRead(root,'SELECT * FROM experience_revisions').length,2);const revision=JSON.parse(String(dbRead(root,'SELECT body FROM experience_revisions WHERE version=2')[0]!.body));assert.equal(revision.counters.length,1);
    assert.deepEqual(readRounds,[0,1]);
  }finally{await h.close();}
});

test('an analyzer cannot add authority fields to adopt personality directly',async()=>{
  const f=await fixture({reply:()=>({...analysis(),adoptPersonality:true})});try{await f.run();assert.equal(dbRead(f.root,'SELECT * FROM experience_items').length,0);
    assert.equal(dbRead(f.root,'SELECT error FROM maintenance_requests')[0]?.error,'INVALID_RESULT');}finally{await f.h.close();}
});

test('oversized visible model output is stopped without publishing a partial interpretation',async()=>{
  const f=await fixture({maxOutputBytes:1024,reply:()=>({...analysis(),summary:'虚构的大量输出'.repeat(200)})});
  try{await f.run();assert.equal(dbRead(f.root,'SELECT * FROM experience_items').length,0);assert.equal(dbRead(f.root,'SELECT state FROM maintenance_requests')[0]?.state,'failed');
    assert.equal(dbRead(f.root,'SELECT * FROM maintenance_watermarks').length,0);}finally{await f.h.close();}
});
