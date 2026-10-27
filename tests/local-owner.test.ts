import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {attachLocalOwnerControl} from '../packages/plugin/lib/local-owner.js';
import {InstallationSettingsSchema} from '../packages/plugin/lib/settings.js';
import {qqCapabilityFixture,bot,owner} from './qq-capabilities-fixture.js';
import {call,textReply} from './harness.js';

test('explicit local owner delegation keeps its real origin and delivers a verified persona result once to the fixed QQ owner',async t=>{
  const h=await qqCapabilityFixture({tasks:true,extraPolicies:[{id:'conversation-local-owner-tasks',producers:['local-owner-tasks'],actions:['local_owner_task_submit'],allowLocalWrite:true},{id:'local-owner-task',producers:['local-owner-tasks'],actions:[],allowLocalWrite:true}]});t.after(h.close);
  const settings=InstallationSettingsSchema.parse({schemaVersion:1,localOwnerControl:true,dataDir:h.root,model:{model:'scripted',credentialStore:'unused'},qq:{botId:bot,ownerId:owner,tokenFile:'unused',httpURL:'http://127.0.0.1:1',wsURL:'ws://127.0.0.1:1'}});
  let chat=0;h.setResponse(request=>{const id=String(request.sessionId);if(id.startsWith('memory-expression-verify-delivery'))return textReply('{"faithful":true,"issues":[]}');if(id.startsWith('dafeiyu-delivery-v3'))return textReply('这是本地主人委托的虚构结果。');if(id.startsWith('dafeiyu-task-')){assert.match(JSON.stringify(request.messages),/taskAccepted/);assert.match(JSON.stringify(request.messages),/after-persona-render-and-verification/);return textReply('虚构任务完成');}return ++chat===1?call('local_owner_task_submit',{requestId:'accept'}):textReply('已受理本机委托。');});
  const dir=join(h.root,'local-owner-control'),id=randomUUID(),badId=randomUUID();mkdirSync(dir);const request={schemaVersion:1,id,issuedAt:new Date().toISOString(),botId:bot,ownerId:owner,text:'写一句明确标注为虚构的结果。'};
  writeFileSync(join(dir,id+'.request.json'),JSON.stringify(request));writeFileSync(join(dir,badId+'.request.json'),JSON.stringify({...request,id:badId,ownerId:'99999999'}));
  let close=attachLocalOwnerControl(h.ctx,settings,'dafeiyu');t.after(()=>close());await h.core.whenIdle();
  assert.ok(existsSync(join(dir,id+'.receipt.json')));assert.match(readFileSync(join(dir,badId+'.receipt.json'),'utf8'),/LOCAL_OWNER_IDENTITY_MISMATCH/);
  assert.equal(h.platform.sent.length,2);assert.ok(h.platform.sent.every(item=>String(item.user_id)===owner));assert.match(JSON.stringify(h.platform.sent),/本地主人委托的虚构结果/);
  const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT state FROM native_deliveries').get()?.state,'sent');}finally{db.close();}
  assert.equal(h.core.journal.list().length,1);assert.equal(h.core.journal.list()[0]!.message.conversation.channel,'local-owner');
  assert.equal(h.core.journal.list()[0]!.message.conversation.id,'local-owner:'+id);
  const chatRequest=h.adapter.requests.find(request=>String(request.sessionId).startsWith('dafeiyu-')&&!String(request.sessionId).startsWith('dafeiyu-task-'))!;
  assert.ok(chatRequest.tools?.some(tool=>tool.name==='local_owner_task_submit'));assert.ok(!chatRequest.tools?.some(tool=>tool.name==='qq_task_submit'||tool.name==='qq_task_status'));
  assert.deepEqual(chatRequest.tools?.map(tool=>tool.name),['local_owner_task_submit']);
  const before=h.adapter.requests.length;close();close=attachLocalOwnerControl(h.ctx,settings,'dafeiyu');await h.core.whenIdle();assert.equal(h.adapter.requests.length,before);assert.equal(h.platform.sent.length,2);
  assert.equal((await h.ctx.dafeiyuQQ.deliverLocalOwner({id:randomUUID(),sourceMessageId:'fake',conversation:{channel:'local-owner',account:bot,kind:'private',id:'99999999'},text:'MUST_NOT_SEND'},new AbortController().signal,()=>{})).status,'not-sent');assert.equal(h.platform.sent.length,2);
});
