import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { MEDIA_ACTIONS } from '@dafeiyu/media';
import { conversationKey } from '@dafeiyu/contracts';
import { qqCapabilityFixture,scene,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

const final='FINAL_PERSONA_TEXT：愿今天有值得好奇的小事。';
const parts=(sent:unknown)=>z.object({message:z.array(z.object({type:z.string(),data:z.record(z.string(),z.unknown())}))}).parse(sent).message.filter(p=>p.type!=='reply');
test('ordinary speech is generated only from the finalized reply and is delivered as a separate fixed audio part',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true,tts:true});try{let step=0;h.setResponse(()=>++step===1?call('dafeiyu_media_reply',{requestId:'speak',expectedVersion:0,parts:[{kind:'final-voice'}]}):textReply(final));const received=await h.message('说一句问候',{trigger:true,id:'1201'});
    const item=h.core.journal.messageFor({agentId:'dafeiyu',route:conversationKey('dafeiyu',scene)},received.id)!;assert.equal(item.state,'delivered',JSON.stringify(h.core.journal.events(item.route).slice(-2)));assert.deepEqual(h.platform.ttsInputs,[final]);
    assert.deepEqual(h.platform.sent.flatMap(parts).map(p=>p.type),['text','record']);const record=h.platform.sent.flatMap(parts).find(p=>p.type==='record')!;const data=Buffer.from(z.string().parse(record.data.file).slice(9),'base64');assert.equal(data.toString('ascii',8,12),'WAVE');
    const exported=h.ctx.dafeiyuMedia.store.replies.exported(item.reply!.id)!;assert.equal(exported.state,'sent');assert.equal(h.ctx.dafeiyuMedia.store.assetWitness(exported.manifest.parts[0]!.asset).coverage.exposed,false);
    const count=h.adapter.requests.length;await h.reload();assert.equal(h.adapter.requests.length,count);assert.deepEqual(h.platform.ttsInputs,[final]);
  }finally{await h.close();}
});

test('a lost synthesized-audio receipt never regenerates speech on duplicate delivery',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true,tts:true});try{h.platform.loseAt=2;let step=0;h.setResponse(()=>++step===1?call('dafeiyu_media_reply',{requestId:'speak',expectedVersion:0,parts:[{kind:'final-voice'}]}):textReply(final));await h.message('语音丢回执样本',{trigger:true,id:'1202'});
    const item=h.core.journal.messageFor({agentId:'dafeiyu',route:conversationKey('dafeiyu',scene)},'1202')!;assert.equal(item.state,'uncertain');const exported=h.ctx.dafeiyuMedia.store.replies.exported(item.reply!.id)!;assert.equal(exported.state,'unknown');await h.reload();
    const result=await h.ctx.dafeiyuQQ.deliverMedia({...item.reply!,media:exported.manifest},new AbortController().signal,()=>{},async()=>{throw new Error('MUST_NOT_REGENERATE');});assert.equal(result.status,'unknown');assert.equal(h.platform.ttsInputs.length,1);
  }finally{await h.close();}
});

test('failed synthesis does not send the text first or retry a failed generation as if no attempt happened',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true,tts:true});try{h.platform.ttsFail=true;let step=0;h.setResponse(()=>++step===1?call('dafeiyu_media_reply',{requestId:'speak',expectedVersion:0,parts:[{kind:'final-voice'}]}):textReply(final));await h.message('合成失败样本',{trigger:true,id:'1203'});
    const item=h.core.journal.messageFor({agentId:'dafeiyu',route:conversationKey('dafeiyu',scene)},'1203')!;assert.equal(item.state,'reply-ready');assert.equal(h.platform.sent.length,0);assert.equal(h.platform.ttsInputs.length,1);
    h.platform.ttsFail=false;h.core.retryDelivery(item.id);await h.core.whenIdle();assert.equal(h.platform.ttsInputs.length,1);assert.equal(h.platform.sent.length,0);
  }finally{await h.close();}
});

test('native speech uses the verified target persona answer rather than the private executor report',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true,tts:true,tasks:true,deliverResults:true,extraTaskActions:[...MEDIA_ACTIONS]}),fetch=globalThis.fetch,failures:{path:string;name:string;cause:string;ms:number}[]=[];
  globalThis.fetch=async(input,init)=>{const start=Date.now();try{return await fetch(input,init);}catch(error){failures.push({path:new URL(String(input)).pathname,name:error instanceof Error?error.name:'unknown',cause:error instanceof Error&&error.cause&&typeof error.cause==='object'&&'code'in error.cause?String(error.cause.code):'',ms:Date.now()-start});throw error;}};
  try{let chat=0,work=0;
    h.setResponse(request=>{const id=String(request.sessionId);if(id.startsWith('dafeiyu-delivery-v3-'))return textReply(final);if(id.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":true,"issues":[]}');
      if(id.startsWith('dafeiyu-task-'))return ++work===1?call('dafeiyu_media_reply',{requestId:'speak-target',expectedVersion:0,parts:[{kind:'final-voice'}]}):textReply('PRIVATE_EXECUTOR_REPORT');
      return ++chat===1?call('qq_task_submit',{requestId:'native-speech'}):textReply('已受理');});await h.message('任务：向当前会话说一句问候',{trigger:true});
    const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT state,error FROM native_deliveries').get();assert.equal(row?.state,'sent',JSON.stringify({row,failures}));}finally{db.close();}
    assert.deepEqual(h.platform.ttsInputs,[final]);assert.ok(!JSON.stringify(h.platform.sent).includes('PRIVATE_EXECUTOR_REPORT'));
    const target=h.adapter.requests.find(r=>String(r.sessionId).startsWith('dafeiyu-delivery-v3-'));assert.ok(target);assert.equal(target.tools?.length??0,0);
  }finally{globalThis.fetch=fetch;await h.close();}
});

test('free-form speech text is rejected by the draft contract before any synthesis',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true,tts:true});try{let step=0;h.setResponse(()=>++step===1?call('dafeiyu_media_reply',{requestId:'raw',expectedVersion:0,parts:[{kind:'final-voice',text:'未经批准的报告'}]}):textReply('没有合成自由文本'));await h.message('拒绝替换正文',{trigger:true});assert.equal(h.platform.ttsInputs.length,0);assert.ok(h.adapter.requests.flatMap(outcomes).every(o=>!o.data||!z.object({selected:z.literal(1)}).safeParse(o.data).success));}
  finally{await h.close();}
});
