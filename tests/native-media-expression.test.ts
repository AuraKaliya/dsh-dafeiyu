import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { MEDIA_ACTIONS } from '@dafeiyu/media';
import { QQ_MEDIA_ACTIONS } from '@dafeiyu/channel-qq';
import { MediaAssetRefSchema } from '@dafeiyu/contracts';
import type { MediaAssetRef,MediaSourceDescription } from '@dafeiyu/contracts';
import { qqCapabilityFixture,scene,otherGroup,bot,owner,until,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

const publicScene={channel:'public-fixture',account:'local',kind:'local' as const,id:'public'};
const native=(id:unknown)=>String(id).startsWith('dafeiyu-task-'),render=(id:unknown)=>String(id).startsWith('dafeiyu-delivery-v3-'),verify=(id:unknown)=>String(id).startsWith('memory-expression-verify-delivery-');
async function setup(mode:'same'|'foreign'|'public',retain=false){const h=await qqCapabilityFixture({media:true,tasks:true,extraTaskActions:[...QQ_MEDIA_ACTIONS,...MEDIA_ACTIONS],extraTaskResources:mode==='public'?[publicScene]:[]});
  const content=mode==='foreign'?'FOREIGN_MEDIA_PRIVATE_SENTINEL':'ALLOWED_DOCUMENT_SENTINEL',data=Buffer.from(content),file=join(h.root,'onebot-cache/document.txt');await writeFile(file,data);h.platform.mediaFiles.set('native-document',file);let cleanup=()=>{},asset:MediaAssetRef|undefined,chat=0,work=0;
  const description:MediaSourceDescription={ref:{provider:'public-fixture',key:'document'},origin:{provider:'public-fixture',scene:publicScene,key:'document',version:1,hash:'a'.repeat(64),roots:['public-fixture:document'],detail:{}},kind:'document',name:'public.txt',mimeHint:'text/plain',bytesHint:data.length,durationMsHint:null,rangeReadable:false,publicContent:true};
  if(mode==='public'){const handle=h.core.registerExtensionV3({protocolVersion:3,id:'public-fixture',version:'1',agentId:'dafeiyu',resourceProofs:{current:p=>p.hash===description.origin.hash,epoch:()=>''}}),unregister=h.core.registerMediaProvider({id:'public-fixture',describe:()=>description,open:async()=>({bytes:data.length,mime:'text/plain',stream:(async function*(){yield data;})()})});cleanup=()=>{unregister();handle.dispose();};}
  else{const before=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:1001,message_type:'group',group_id:Number(mode==='foreign'?otherGroup:scene.id),user_id:Number(owner),time:1792886400,message:[{type:'file',data:{file:'native-document',name:'document.txt'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>before);}
  h.setResponse(request=>{if(render(request.sessionId))return textReply('已准备一份来源明确的附件，正文仅依据获准材料。');if(verify(request.sessionId))return textReply('{"faithful":true,"issues":[]}');
    if(!native(request.sessionId))return ++chat===1?call('qq_task_submit',{requestId:'media-task'}):textReply('任务已受理');work++;
    if(mode!=='public'&&work===1)return call('qq_media_list',{target:mode==='foreign'?{...scene,id:otherGroup}:scene,messageId:'1001'});
    const index=work-(mode==='public'?0:1);
    if(index===1){const source=mode==='public'?description.ref:z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))}).parse(outcomes(request).at(-1)?.data).media[0]!.ref;return call('dafeiyu_media_acquire',{requestId:'get-document',source});}
    if(index===2){asset=MediaAssetRefSchema.parse(outcomes(request).at(-1)?.data);return call('dafeiyu_media_read',{requestId:'read-document',asset,mode:'document'});}
    if(retain&&index===3){const observed=z.object({exposureId:z.string(),observation:z.object({source:z.object({id:z.string(),version:z.number()})})}).parse(outcomes(request).at(-1)?.data);return call('dafeiyu_media_select',{requestId:'retain',exposureId:observed.exposureId,observationId:observed.observation.source.id,version:1,mode:'original',reason:'保留有来源的文档片段'});}
    if(index===(retain?4:3))return call('dafeiyu_media_reply',{requestId:'draft',expectedVersion:0,parts:[{kind:'asset',asset,as:'file'}]});return textReply('PRIVATE_EXECUTOR_REPORT_SENTINEL：只供内部处理');});
  await h.message('任务：读取获准材料并准备附件',{trigger:true,id:'1002'});const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});let runId:string;try{runId=String(db.prepare("SELECT r.id FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks' ORDER BY r.rowid DESC LIMIT 1").get()?.id);assert.equal(db.prepare('SELECT state FROM runs WHERE id=?').get(runId)?.state,'completed');}finally{db.close();}
  return {...h,runId,close:async()=>{cleanup();await h.close();}};
}

for(const mode of ['same','public'] as const)test(`native ${mode} media has target material and a media-bound verified text credential`,async()=>{
  const h=await setup(mode);try{const packet=await h.core.prepareMessageTaskExpression(h.runId);assert.ok(packet.media);assert.equal(packet.media.parts[0]?.kind,'asset');assert.ok(packet.evidence.some(e=>e.text.includes('ALLOWED_DOCUMENT_SENTINEL')));assert.equal(packet.resultIncluded,false);assert.ok(!JSON.stringify(packet).includes('PRIVATE_EXECUTOR_REPORT_SENTINEL'));
    const sentBefore=h.platform.sent.length,status=await h.core.deliverMessageTaskResult(h.runId);assert.equal(status?.state,'rejected');assert.equal(status?.error,'MEDIA_DELIVERY_NOT_CONFIGURED');const target=h.adapter.requests.find(r=>render(r.sessionId));assert.ok(target);assert.ok(!JSON.stringify(target).includes('PRIVATE_EXECUTOR_REPORT_SENTINEL'));assert.equal(target.tools?.length??0,0);
    const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT material,credential,body FROM native_deliveries WHERE run_id=?').get(h.runId)!;assert.equal(JSON.parse(String(row.material)).mediaStamp,packet.media.sourceStamp);assert.ok(row.credential);assert.match(String(row.body),/获准材料/);}finally{db.close();}
    assert.equal(h.platform.sent.length,sentBefore,'no task-result payload is sent before a media-capable transport is configured');
  }finally{await h.close();}
});

test('a native draft from another private group is rejected before target material or renderer access',async()=>{
  const h=await setup('foreign');try{await assert.rejects(h.core.prepareMessageTaskExpression(h.runId),/MEDIA_TARGET_DENIED/);const state=await h.core.deliverMessageTaskResult(h.runId);assert.equal(state?.state,'rejected');assert.equal(state?.error,'MEDIA_TARGET_DENIED');assert.ok(!h.adapter.requests.some(r=>render(r.sessionId)));
    const db=new DatabaseSync(join(h.root,'memory/memory.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM native_expression_packets').get()?.n,0);}finally{db.close();}
  }finally{await h.close();}
});

test('forgetting a selected media root blocks raw export, and restoration cannot revive its older packet',async()=>{
  const h=await setup('public',true);try{const packet=await h.core.prepareMessageTaskExpression(h.runId);assert.ok(packet.media);const db=new DatabaseSync(join(h.root,'memory/memory.sqlite'));
    try{const row=db.prepare('SELECT id FROM memory_items LIMIT 1').get();assert.ok(row);db.prepare('UPDATE memory_items SET deleted=1,version=version+1 WHERE id=?').run(row.id!);
      await assert.rejects(h.core.openMessageTaskExpression(h.runId,packet.id),/SOURCE_STALE|MEDIA_SOURCE_SUPPRESSED/);db.prepare('UPDATE memory_items SET deleted=0,version=version+1 WHERE id=?').run(row.id!);await assert.rejects(h.core.openMessageTaskExpression(h.runId,packet.id),/SOURCE_STALE/);
    }finally{db.close();}
  }finally{await h.close();}
});
