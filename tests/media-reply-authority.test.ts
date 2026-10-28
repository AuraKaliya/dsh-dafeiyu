import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { ExecutionContext,MediaReplyAuthority } from '@dafeiyu/contracts';
import { conversationKey } from '@dafeiyu/contracts';
import { qqCapabilityFixture,privateScene,owner,bot,until } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

test('reply authority is captured from a live write grant and reopened from completed persisted reply facts',async()=>{
  const h=await qqCapabilityFixture({extraConversationActions:['fixture_reply_prepare']});let captured:MediaReplyAuthority|undefined,context:ExecutionContext|undefined,step=0;
  const handle=h.core.registerExtension({protocolVersion:4,id:'reply-fixture',version:'1',agentId:'dafeiyu',actions:[{id:'fixture_reply_prepare',version:'1',description:'scoped reply authority fixture',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write',execute:async(_input,c)=>{
    context=c;assert.throws(()=>h.core.captureMediaReplyAuthority({...c},'reply-fixture','a'.repeat(64)),/SCOPE_DENIED/);captured=h.core.captureMediaReplyAuthority(c,'reply-fixture','a'.repeat(64));
    return {status:'succeeded',effects:'confirmed',completeness:'complete',data:{prepared:true},sources:[],receipts:[]};}}]});
  try{h.setResponse(()=>++step===1?call('fixture_reply_prepare',{}):textReply('经过实际会话生成的最终正文'));await h.message('准备回复',{target:privateScene,id:'901'});assert.ok(captured);assert.throws(()=>h.core.captureMediaReplyAuthority(context!,'reply-fixture','a'.repeat(64)),/SCOPE_DENIED/);
    const item=h.core.journal.messageFor({agentId:'dafeiyu',route:conversationKey('dafeiyu',privateScene)},'901')!;assert.ok(item.reply);
    await assert.rejects(h.core.prepareMediaReplyAccess(captured,{...item.reply!,text:'替换最终正文'},new AbortController().signal),/BINDING_CONFLICT/);
    await assert.rejects(h.core.prepareMediaReplyAccess({...captured,hash:'0'.repeat(64)},item.reply!,new AbortController().signal),/SCOPE_DENIED/);
    const access=await h.core.prepareMediaReplyAccess(captured,item.reply!,new AbortController().signal);try{h.core.validateMediaReplyAccess(access);assert.equal(access.text,item.reply!.text);assert.equal(access.payloadHash,'a'.repeat(64));assert.throws(()=>h.core.validateMediaReplyAccess({...access}),/SCOPE_DENIED/);
      h.emit({post_type:'notice',notice_type:'friend_recall',self_id:Number(bot),user_id:Number(owner),message_id:901});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled>0);assert.throws(()=>access.guard(),/SOURCE_STALE/);
    }finally{access.release();}assert.throws(()=>h.core.validateMediaReplyAccess(access),/SCOPE_DENIED/);
  }finally{handle.dispose();await h.close();}
});

test('read-only tools cannot capture a durable outgoing authority',async()=>{
  const h=await qqCapabilityFixture({extraConversationActions:['fixture_reply_readonly']});let denied=false,step=0;
  const handle=h.core.registerExtension({protocolVersion:4,id:'reply-fixture',version:'1',agentId:'dafeiyu',actions:[{id:'fixture_reply_readonly',version:'1',description:'read-only reply fixture',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'read',execute:async(_input,c)=>{
    assert.throws(()=>h.core.captureMediaReplyAuthority(c,'reply-fixture','a'.repeat(64)),/SCOPE_DENIED/);denied=true;return {status:'succeeded',effects:'none',completeness:'complete',data:{denied:true},sources:[],receipts:[]};}}]});
  try{h.setResponse(()=>++step===1?call('fixture_reply_readonly',{}):textReply('只读授权不能准备外发'));await h.message('检查范围',{target:privateScene});assert.equal(denied,true);}finally{handle.dispose();await h.close();}
});
