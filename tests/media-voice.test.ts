import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { MediaVoiceEvidence,ExecutionContext } from '@dafeiyu/contracts';
import { qqCapabilityFixture,bot,owner,privateScene,until,outcomes } from './qq-capabilities-fixture.js';
import { syntheticPcm } from './media-pcm-fixture.js';
import { call,textReply } from './harness.js';

for(const variant of ['complete','partial','silence','file','not-exposed','cropped-asset'] as const)test(`voice evidence ${variant} binds actual PCM and can never be supplied as free model text`,async()=>{
  const h=await qqCapabilityFixture({media:true,audio:true,extraConversationActions:['fixture_voice_evidence']});let captured:MediaVoiceEvidence|undefined,error:string|undefined,step=0,exposureId:string|undefined,earlyRejected=false;
  if(variant==='not-exposed'){const read=h.ctx.dafeiyuMedia.read.bind(h.ctx.dafeiyuMedia);h.ctx.dafeiyuMedia.read=async(context,owner,input)=>{const result=await read(context,owner,input),view=z.object({exposureId:z.string()}).parse(result);
    assert.throws(()=>h.core.mediaVoiceEvidence(context,owner,view.exposureId),/OBSERVATION_NOT_EXPOSED/);earlyRejected=true;return result;};}
  const handle=h.core.registerExtension({protocolVersion:4,id:'voice-fixture',version:'1',agentId:'dafeiyu',actions:[{id:'fixture_voice_evidence',version:'1',description:'program-only voice proof fixture',inputSchema:z.strictObject({exposureId:z.string()}),outputSchema:z.json(),effects:'read',execute:async(input,c:ExecutionContext)=>{
    try{const id=z.object({exposureId:z.string()}).parse(input).exposureId;assert.throws(()=>h.core.mediaVoiceEvidence({...c},'voice-fixture',id),/SCOPE_DENIED/);const actual=h.core.mediaVoiceEvidence(c,'voice-fixture',id);captured=actual.evidence;assert.equal(actual.text,h.platform.transcript);return {status:'succeeded',effects:'none',completeness:'complete',data:{valid:true},sources:[],receipts:[]};}
    catch(e){error=e instanceof Error?e.message:'unknown';return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:/^[A-Z_]+$/.test(error)?error:'VOICE_TEST_FAILED'};}}}]});
  try{const file=join(h.root,'onebot-cache/voice.wav');await writeFile(file,syntheticPcm(32000));h.platform.mediaFiles.set('voice-handle',file);h.platform.speechDetected=variant!=='silence';
    h.setResponse(request=>{step++;if(step===1)return call('qq_media_list',{});if(step===2){const list=outcomes(request).flatMap(o=>{const value=z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))}).safeParse(o.data);return value.success?value.data.media:[];});assert.ok(list.length);return call('dafeiyu_media_read',{requestId:'voice',source:list[0]!.ref,mode:'audio',interval:{startMs:0,endMs:variant==='partial'||variant==='cropped-asset'?1000:2000}});}
      if(variant==='cropped-asset'&&step===3){const views=outcomes(request).flatMap(o=>{const view=z.object({assets:z.array(z.json())}).safeParse(o.data);return view.success?view.data.assets:[];});assert.ok(views.length);return call('dafeiyu_media_read',{requestId:'crop-as-whole',asset:views.at(-1),mode:'audio',interval:{startMs:0,endMs:1000}});}
      if(step===(variant==='cropped-asset'?4:3)){const read=outcomes(request).flatMap(o=>{const value=z.object({exposureId:z.string()}).safeParse(o.data);return value.success?[value.data]:[];});assert.ok(read.length);exposureId=read.at(-1)!.exposureId;
        if(variant==='not-exposed'){// A fresh message has not consumed the prior observation.
          return textReply('先结束，不使用此语音证明');}
        return call('fixture_voice_evidence',{exposureId});}return textReply('语音证明检查结束');});
    const received=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:701,message_type:'private',user_id:Number(owner),time:1792886400,message:[{type:variant==='file'?'file':'record',data:{file:'voice-handle',name:'voice.wav'}}]});
    await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>received);await h.core.whenIdle();
    if(variant==='complete'){assert.ok(captured,error);assert.equal(captured.sourceDurationMs,2000);assert.equal(h.core.mediaVoiceCurrent(captured),true);assert.equal(h.core.mediaVoiceCurrent({...captured,transcriptHash:'0'.repeat(64)}),false);
      h.emit({post_type:'notice',notice_type:'friend_recall',self_id:Number(bot),user_id:Number(owner),message_id:701});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled>0);assert.equal(h.core.mediaVoiceCurrent(captured),false);
    }else if(variant==='not-exposed'){
      assert.ok(exposureId);assert.equal(earlyRejected,true);assert.equal(captured,undefined);
    }else{assert.equal(captured,undefined);assert.match(error??'',/VOICE_INCOMPLETE|VOICE_INELIGIBLE|VOICE_SOURCE_NOT_WHOLE/);}
  }finally{handle.dispose();await h.close();}
});
