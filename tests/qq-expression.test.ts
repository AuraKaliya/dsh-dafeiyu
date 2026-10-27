import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { qqMessageSequence } from '@dafeiyu/contracts';
import { qqReplyDelayMs,QqStore } from '@dafeiyu/qq';
import { join } from 'node:path';
import { qqCapabilityFixture,scene,privateScene,bot,owner,until,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
const prefs=['dafeiyu_qq_expression_save','dafeiyu_qq_expression_status'];
const sequence=(...texts:string[])=>JSON.stringify({qq_messages:texts.map(text=>({type:'text',text}))});
const texts=(sent:Record<string,unknown>[])=>sent.flatMap(raw=>z.object({message:z.array(z.object({type:z.string(),data:z.record(z.string(),z.unknown())}))}).parse(raw).message).flatMap(part=>part.type==='text'?[String(part.data.text)]:[]);

test('one QQ turn sends intentional messages and quotes only the first; newlines stay inside a message',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);h.setResponse(()=>textReply(sequence('先说第一件事。\n这是同一条消息。','再说第二件事。')));
  await h.message('说两件事',{trigger:true,id:'9821'});assert.deepEqual(texts(h.platform.sent),['先说第一件事。\n这是同一条消息。','再说第二件事。']);
  assert.equal(JSON.stringify(h.platform.sent[0]).includes('"type":"reply"'),true);assert.equal(JSON.stringify(h.platform.sent[1]).includes('"type":"reply"'),false);
  assert.deepEqual(qqMessageSequence('```json\n'+sequence('  keep indent')+'\n```').messages,['  keep indent']);
  assert.equal(qqReplyDelayMs(sequence('你好','世界')),qqReplyDelayMs('你好世界'));assert.equal(qqReplyDelayMs(JSON.stringify({qq_messages:[{type:'media'}]})),2000);
});
test('invalid message envelopes never reach QQ as raw JSON',async t=>{const h=await qqCapabilityFixture();t.after(h.close);h.setResponse(()=>textReply('{"qq_messages":[{"type":"text","text":""}]}'));await h.message('测试格式',{trigger:true,id:'9822'});assert.equal(h.platform.sent.length,0);assert.equal(h.core.journal.list()[0]?.state,'failed');assert.throws(()=>qqMessageSequence('{"qq_messages":null}'),/QQ_MESSAGE_SEQUENCE_INVALID/);});
test('an uncertain segment stops the remainder and is not resent after connector reload',async t=>{const h=await qqCapabilityFixture();t.after(h.close);h.platform.loseAt=2;h.setResponse(()=>textReply(sequence('第一条','第二条','第三条')));await h.message('分三条说',{trigger:true,id:'9823'});assert.deepEqual(texts(h.platform.sent),['第一条','第二条']);await h.reload();await h.core.whenIdle();assert.equal(h.platform.sent.length,2);});
test('a new authentic message from the same sender cancels the unsent tail',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);let generation=0,interrupted=false;h.setResponse(()=>textReply(++generation===1?sequence('先发出这一条','待发第二条','待发第三条'):'按新要求处理。'));
  h.platform.beforeVerify=async()=>{if(interrupted||h.platform.sent.length!==1)return;interrupted=true;const received=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:9825,message_type:'group',group_id:Number(scene.id),user_id:Number(owner),time:Math.ceil(Date.now()/1000),message:[{type:'text',data:{text:'改一下，先停在这里。'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>received);};
  await h.message('分开讲三条',{trigger:true,id:'9824'});assert.deepEqual(texts(h.platform.sent),['先发出这一条','按新要求处理。']);
});

test('Growth saves a QQ preference in existing memory and assembles it after a full local restart without crossing groups',async t=>{
  let h=await qqCapabilityFixture({extraConversationActions:prefs});t.after(()=>h.close());const root=h.root;let step=0;
  h.setResponse(request=>{if(++step===1)return call('dafeiyu_qq_expression_save',{requestId:'style',slot:'structure',text:'每条只讲一个意思，偏好短句。',basis:'self-preference',expectedVersion:0});assert.equal(outcomes(request).at(-1)?.status,'succeeded');assert.match(JSON.stringify(request.messages),/每条只讲一个意思/);return textReply('我会分开说。');});
  await h.message('按自己的偏好调整说法',{trigger:true,id:'9826'});await h.close();h=await qqCapabilityFixture({existingRoot:root,extraConversationActions:prefs});
  h.setResponse(request=>{assert.match(JSON.stringify(request.messages),/每条只讲一个意思/);return textReply('这一轮仍然记得。');});await h.message('继续',{trigger:true,id:'9827'});
  h.setResponse(request=>{assert.doesNotMatch(JSON.stringify(request.messages),/每条只讲一个意思/);return textReply('另一个会话。');});await h.message('你好',{target:privateScene,id:'9828'});
});

test('a naturally accepted QQ task can report stages and save an expression preference for its original conversation',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true,turnTimeoutMs:30000,extraTaskActions:[...prefs,'qq_progress'],extraExternalActions:[{extensionId:'qq-progress',actionId:'qq_progress',actionVersion:'1'}]});t.after(h.close);let chat=0,work=0;
  h.setResponse(request=>{const id=String(request.sessionId);if(id.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":true,"issues":[]}');
    if(id.startsWith('dafeiyu-progress-v1-')){assert.equal(request.tools?.length??0,0);return textReply('我先整理一下说法。');}
    if(id.startsWith('dafeiyu-delivery-v3-')){assert.equal(request.tools?.length??0,0);assert.match(JSON.stringify(request.messages),/尽量用口语表达/);return textReply(sequence('好，以后尽量用口语。','偏好已经保存。'));}
    if(id.startsWith('dafeiyu-task-')){if(++work===1)return call('qq_progress',{kind:'intent',text:'先整理说法，再保存偏好。'});if(work===2)return call('dafeiyu_qq_expression_save',{requestId:'task-style',slot:'tone',text:'尽量用口语表达。',basis:'user-request',expectedVersion:0});assert.ok(outcomes(request).some(outcome=>outcome.status==='succeeded'));return textReply('已保存口语表达偏好。');}
    return ++chat===1?call('qq_task_submit',{requestId:'natural-style'}):textReply('');});
  await h.message('之后说得口语一点，保存成偏好',{target:scene,trigger:true,id:'9829'});assert.deepEqual(texts(h.platform.sent),['我先整理一下说法。','好，以后尽量用口语。','偏好已经保存。']);
});


test('a selected local sticker keeps its model-chosen place between text messages',async t=>{
  const h=await qqCapabilityFixture({media:true,stickers:true});t.after(h.close);
  const store=new QqStore(join(h.root,'qq/qq.sqlite')),gif=Buffer.from('47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b','hex');
  try{store.stickers.collect(scene,{messageId:'9830',sender:owner},{name:'开心小鱼',description:'虚构开心表情',tags:['开心']},gif,'image/gif');}finally{store.close();}
  let step=0;h.setResponse(request=>{if(++step===1)return call('qq_sticker_list',{});if(step===2){const data=z.object({stickers:z.array(z.object({id:z.string()}))}).parse(outcomes(request).at(-1)?.data);return call('qq_sticker_use',{requestId:'ordered',expectedVersion:0,id:data.stickers[0]!.id});}return textReply(JSON.stringify({qq_messages:[{type:'text',text:'先说一句。'},{type:'media'},{type:'text',text:'再接一句。'}]}));});
  await h.message('配个表情聊两句',{trigger:true,id:'9830'});assert.equal(h.platform.sent.length,3);const kinds=h.platform.sent.map(raw=>z.object({message:z.array(z.object({type:z.string()}))}).parse(raw).message.at(-1)!.type);assert.deepEqual(kinds,['text','image','text']);assert.deepEqual(texts(h.platform.sent),['先说一句。','再接一句。']);
});
