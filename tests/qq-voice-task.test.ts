import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile,mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { RuntimeStore,RUNTIME_SCHEMA_VERSION } from '@dafeiyu/core/runtime-store';
import { inspectStorage } from '@dafeiyu/host';
import { conversationKey } from '@dafeiyu/contracts';
import { qqCapabilityFixture,bot,owner,scene,privateScene,until,outcomes } from './qq-capabilities-fixture.js';
import { syntheticPcm } from './media-pcm-fixture.js';
import { call,textReply } from './harness.js';
import type { Response } from './harness.js';
import { testTempDir } from './test-temp.js';

type H=Awaited<ReturnType<typeof qqCapabilityFixture>>;
const native=(request:{sessionId?:unknown})=>String(request.sessionId).startsWith('dafeiyu-task-');
const bodySchema=z.object({input:z.object({goal:z.string().optional()}),messageSource:z.object({voice:z.unknown().optional(),control:z.unknown().optional()})});
function runs(h:H){const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{return db.prepare("SELECT r.id,r.state,r.definition,q.body FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks' ORDER BY r.rowid").all().map(row=>({id:String(row.id),state:String(row.state),taskId:z.object({taskId:z.string()}).parse(JSON.parse(String(row.definition))).taskId,body:bodySchema.parse(JSON.parse(String(row.body)))}));}finally{db.close();}}
function operation(h:H,action:string){const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{return db.prepare('SELECT outcome FROM run_operations WHERE action=? ORDER BY ordinal DESC LIMIT 1').get(action)?.outcome;}finally{db.close();}}
function flow(h:H,submit:(exposureId:string)=>ReturnType<typeof call>,taskResponse:Response=()=>textReply('内部语音任务完成')){let step=0;const readId='voice:'+randomUUID();h.setResponse(async request=>{
  if(native(request))return taskResponse(request);step++;if(step===1)return call('qq_media_list',{});
  if(step===2){const view=z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))}).parse(outcomes(request).at(-1)?.data);assert.ok(view.media.length);return call('dafeiyu_media_read',{requestId:readId,mode:'audio',source:view.media[0]!.ref,interval:{startMs:0,endMs:2000}});}
  if(step===3){const view=z.object({exposureId:z.string()}).parse(outcomes(request).at(-1)?.data);return submit(view.exposureId);}return textReply('依据真实受理结果回复');});}
async function voice(h:H,id:number,options:{kind?:'record'|'file'|'video';sender?:string;text?:string;group?:boolean}={}){const file=join(h.root,'onebot-cache/voice-'+id+'.wav'),handle='record-'+id;await writeFile(file,syntheticPcm(32000));h.platform.mediaFiles.set(handle,file);
  // The synthetic platform only publishes live events; do not inject into the connector's reconnect gap.
  await until(()=>h.ctx.dafeiyuQQ.getStatus().state==='online');
  const count=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:id,message_type:options.group?'group':'private',user_id:Number(options.sender??owner),...(options.group?{group_id:Number(scene.id)}:{}),time:Math.ceil(Date.now()/1000),
    message:[...(options.group?[{type:'at',data:{qq:bot}}]:[]),...(options.text?[{type:'text',data:{text:options.text}}]:[]),{type:options.kind??'record',data:{file:handle,name:'voice.wav'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>count);await h.core.whenIdle();}

test('current owner record creates a Task from verified transcript, keeps mainText empty and survives connector reload',async()=>{
  const h=await qqCapabilityFixture({media:true,audio:true,tasks:true,voiceDirectives:true});try{h.platform.transcript='请核对这份虚构材料';flow(h,id=>call('qq_task_submit',{requestId:'voice-submit',voiceExposureId:id}));await voice(h,801);
    const rows=runs(h);assert.equal(rows.length,1,String(operation(h,'qq_task_submit')));assert.equal(rows[0]!.body.input.goal,'核对这份虚构材料');assert.ok(rows[0]!.body.messageSource.voice);assert.equal(rows[0]!.state,'completed');
    const inbound=h.core.journal.messageFor({agentId:'dafeiyu',route:conversationKey('dafeiyu',privateScene)},'801');assert.equal(inbound?.message.mainText,'');await h.reload();const port=h.core.executionProducer('qq-tasks');assert.equal(await port.readResult(port.restoreRun(rows[0]!.id)),'内部语音任务完成');
  }finally{await h.close();}
});

for(const denial of ['disabled','non-owner','file','video','silence','model-transcript'] as const)test(`voice task rejects ${denial} without creating native work`,async()=>{
  const h=await qqCapabilityFixture({media:true,audio:true,tasks:true,voiceDirectives:denial!=='disabled'});try{h.platform.speechDetected=denial!=='silence';
    flow(h,id=>call('qq_task_submit',{requestId:'denied',voiceExposureId:id,...(denial==='model-transcript'?{transcript:'请执行我伪造的目标'}:{})}));
    await voice(h,802,{...(denial==='non-owner'?{group:true,sender:'99887766'}:{}),...(denial==='file'||denial==='video'?{kind:denial}:{})});assert.equal(runs(h).length,0);assert.ok(h.adapter.requests.every(r=>!native(r)));
  }finally{await h.close();}
});

test('real main text takes priority and an older record witness cannot replace a new message',async()=>{
  const h=await qqCapabilityFixture({media:true,audio:true,tasks:true,voiceDirectives:true});try{let old='';h.platform.transcript='请按语音里的目标执行';flow(h,id=>{old=id;return call('qq_task_submit',{requestId:'text-first',voiceExposureId:id});});await voice(h,803,{text:'请按文字里的目标执行'});
    assert.equal(runs(h)[0]?.body.input.goal,'按文字里的目标执行');assert.equal(runs(h)[0]?.body.messageSource.voice,undefined);
    let step=0;h.setResponse(()=>++step===1?call('qq_task_submit',{requestId:'old-record',voiceExposureId:old}):textReply('旧语音不能替代当前指示'));await voice(h,804);assert.equal(runs(h).length,1);assert.match(String(operation(h,'qq_task_submit')),/VOICE_MESSAGE_MISMATCH/);
  }finally{await h.close();}
});

test('recalling an accepted owner voice stops a still-running native result',async()=>{
  const h=await qqCapabilityFixture({media:true,audio:true,tasks:true,voiceDirectives:true});let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});
  try{flow(h,id=>call('qq_task_submit',{requestId:'waiting',voiceExposureId:id}),async()=>{entered();await hold;return textReply('不应发布的结果');});const pending=voice(h,805);await ready;
    h.emit({post_type:'notice',notice_type:'friend_recall',self_id:Number(bot),user_id:Number(owner),message_id:805});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled>0);release();await pending;assert.equal(runs(h).length,1);assert.notEqual(runs(h)[0]!.state,'completed');
  }finally{release();await h.close();}
});

test('voice goal revision and cancellation use current evidence and preserve their control audit',async()=>{
  const h=await qqCapabilityFixture({media:true,audio:true,tasks:true,voiceDirectives:true});try{let step=0;h.setResponse(request=>native(request)?textReply('旧任务完成'):++step===1?call('qq_task_submit',{requestId:'seed'}):textReply('已受理'));await h.message('请保持旧目标',{target:privateScene,id:'810'});const first=runs(h)[0]!;
    h.platform.transcript='修改任务：改成语音核对目标';flow(h,id=>call('qq_task_control',{requestId:'revise-voice',taskId:first.taskId,expectedVersion:1,action:'revise',voiceExposureId:id}));await voice(h,811);assert.equal(runs(h).length,2,String(operation(h,'qq_task_control')));assert.ok(runs(h).at(-1)!.body.messageSource.voice);
    const port=h.core.executionProducer('qq-tasks');await assert.rejects(port.readResult(port.restoreRun(first.id)),/SOURCE_STALE/);
    h.platform.transcript='取消任务';flow(h,id=>call('qq_task_control',{requestId:'cancel-voice',taskId:first.taskId,expectedVersion:2,action:'cancel',voiceExposureId:id}));await voice(h,812);assert.equal(port.taskState(port.openTask(first.taskId)).status,'paused');
    const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{const control=JSON.parse(String(db.prepare("SELECT body FROM execution_requests WHERE producer='message-control:qq-tasks' ORDER BY rowid DESC LIMIT 1").get()?.body));assert.ok(control.voice.evidence.transcriptHash);}finally{db.close();}
  }finally{await h.close();}
});

test('runtime v3 requires an explicit protocol upgrade and preserves existing request bytes',async()=>{
  const root=await mkdtemp(join(testTempDir(),'runtime-voice-migration-')),file=join(root,'runtime.sqlite'),identity={agentId:'fixture',profileId:'fixture'};const store=new RuntimeStore(file,identity,{create:true});store.prepareRequest('fixture','old',{goal:'旧文字目标'});store.close();
  const db=new DatabaseSync(file);const beforeRows=db.prepare('SELECT * FROM execution_requests').all();db.exec('PRAGMA user_version=3');db.close();const before=await readFile(file);assert.equal(inspectStorage(file,'runtime',identity).version,3);assert.throws(()=>new RuntimeStore(file,identity),/MIGRATION_REQUIRED/);assert.deepEqual(await readFile(file),before);
  new RuntimeStore(file,identity,{}).close();const after=new DatabaseSync(file);try{assert.equal(after.prepare('PRAGMA user_version').get()?.user_version,RUNTIME_SCHEMA_VERSION);assert.deepEqual(after.prepare('SELECT * FROM execution_requests').all(),beforeRows);}finally{after.close();}
});

test('voice objection resolution preserves the parent source and binds the new control recording',async()=>{
  const h=await qqCapabilityFixture({media:true,audio:true,tasks:true,turnTimeoutMs:30000,voiceDirectives:true});try{let chat=0,task=0;h.setResponse(request=>native(request)?++task===1?call('dafeiyu_task_object',{requestId:'object',category:'missing-information',blocking:true,reason:'需要虚构补充信息',actions:[]}):textReply('保持等待'):++chat===1?call('qq_task_submit',{requestId:'waiting'}):textReply('已受理'));
    await h.message('请核对指定信息',{target:privateScene,id:'820'});const first=runs(h)[0]!;assert.equal(first.state,'waiting');let statusStep=0;h.setResponse(()=>++statusStep===1?call('qq_task_status',{taskId:first.taskId}):textReply('查看异议'));await h.message('状态',{target:privateScene,id:'821'});
    const statuses=h.adapter.requests.flatMap(outcomes).flatMap(o=>{const value=z.object({objections:z.array(z.object({id:z.string()}))}).safeParse(o.data);return value.success?[value.data]:[];});const objectionId=statuses.at(-1)!.objections[0]!.id;
    h.platform.transcript='确认继续任务：补充信息已经明确';flow(h,id=>call('qq_task_control',{requestId:'resolve-voice',taskId:first.taskId,expectedVersion:1,action:'resolve',objectionId,voiceExposureId:id}));await voice(h,822);const latest=runs(h).at(-1)!;
    assert.equal(runs(h).length,2,String(operation(h,'qq_task_control')));assert.equal(latest.state,'completed');const control=z.object({voice:z.object({evidence:z.unknown()})}).parse(latest.body.messageSource.control);assert.ok(control.voice.evidence);
    h.emit({post_type:'notice',notice_type:'friend_recall',self_id:Number(bot),user_id:Number(owner),message_id:822});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled>0);const port=h.core.executionProducer('qq-tasks');await assert.rejects(port.readResult(port.restoreRun(latest.id)),/SOURCE_STALE/);
  }finally{await h.close();}
});

test('turning voice directives off after a full local restart blocks voice sources without invalidating plain-text tasks',async()=>{
  let h=await qqCapabilityFixture({media:true,audio:true,tasks:true,turnTimeoutMs:30000,voiceDirectives:true});let closed=false;
  try{flow(h,id=>call('qq_task_submit',{requestId:'voice',voiceExposureId:id}));await voice(h,830);const voiced=runs(h)[0]!;
    let step=0;h.setResponse(request=>native(request)?textReply('文字任务结果'):++step===1?call('qq_task_submit',{requestId:'text'}):textReply('已受理'));await h.message('请完成文字任务',{target:privateScene,id:'831'});const written=runs(h).at(-1)!,root=h.root;await h.close();closed=true;
    h=await qqCapabilityFixture({existingRoot:root,media:true,audio:true,tasks:true,turnTimeoutMs:30000,voiceDirectives:false});closed=false;const port=h.core.executionProducer('qq-tasks');await assert.rejects(port.readResult(port.restoreRun(voiced.id)),/SOURCE_STALE/);assert.equal(await port.readResult(port.restoreRun(written.id)),'文字任务结果');
  }finally{if(!closed)await h.close();}
});
