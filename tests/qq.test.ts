import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testTempDir as tmpdir } from './test-temp.js';
import * as QQ from '@dafeiyu/qq';
import { harness, textReply } from './harness.js';
import type { Response } from './harness.js';
import { groupPacket, assertGroupQuery } from './qq-group-packet-fixture.js';
import type { GroupPacketFixture } from './qq-group-packet-fixture.js';
import { DatabaseSync } from 'node:sqlite';

const bot='1994142241', owner='10000003', group='1106067626';
const token='local-test-token-not-a-real-secret-1234567890';
async function until(predicate:()=>boolean) {
  const deadline=Date.now()+4000;
  while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(predicate(),'condition did not become true');
}
async function setup(initialIdentity=bot, features: Pick<QQ.Config, 'naturalNames' | 'groupSync'> = {}, response?: Response) {
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-qq-'));
  const tokenFile=join(root,'token');await writeFile(tokenFile,token);
  const platform={ identity:initialIdentity, sent:[] as Record<string,unknown>[], loseResponse:false, nextId:-1000,
    groups:[{group_id:Number(group),group_name:'虚构测试群'}] as GroupPacketFixture[],groupCalls:0,failGroups:false };
  const server=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}
    let raw='';for await(const part of req)raw+=String(part);
    const params:Record<string,unknown>=JSON.parse(raw||'{}');
    let data:unknown;
    if(req.url==='/get_login_info')data={user_id:Number(platform.identity)};
    else if(req.url==='/get_status')data={online:true};
    else if(req.url==='/get_group_list'){platform.groupCalls++;if(platform.failGroups){res.writeHead(503).end();return;}data=platform.groups;}
    else if(req.url==='/send_packet'){platform.groupCalls++;assertGroupQuery(raw);if(platform.failGroups){res.writeHead(503).end();return;}data=groupPacket(platform.groups);}
    else if(req.url==='/send_private_msg'||req.url==='/send_group_msg'){
      platform.sent.push(params);data={message_id:platform.nextId--};
      if(platform.loseResponse){res.destroy();return;}
    }else {res.writeHead(404).end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));
  });
  const wss=new WebSocketServer({server});
  wss.on('connection',(ws,req)=>{if(req.headers.authorization!=='Bearer '+token)ws.close();});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('No bound test port');
  const h=await harness(join(root,'core'),response);
  const config={agentId:'dafeiyu',botId:bot,ownerId:owner,groupIds:[group],httpURL:`http://127.0.0.1:${address.port}/`,
    wsURL:`ws://127.0.0.1:${address.port}/`,tokenFile,dataDir:join(root,'qq'),reconnectMs:100,requestTimeoutMs:500,...features};
  let fiber=await h.ctx.plugin(QQ,config);
  if(initialIdentity===bot)await until(()=>h.ctx.dafeiyuQQ.getStatus().state==='online'&&wss.clients.size>0);
  return {...h,platform,config,wss,
    emit:(event:object)=>{for(const ws of wss.clients)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(event));},
    reload:async()=>{await fiber.dispose();fiber=await h.ctx.plugin(QQ,config);await until(()=>h.ctx.dafeiyuQQ.getStatus().state==='online');},
    stop:async()=>{await fiber.dispose();await h.close();for(const ws of wss.clients)ws.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));},
  };
}
function message(id:string,kind:'private'|'group'='private',segments:object[]=[{type:'text',data:{text:'你好'}}]){
  return {post_type:'message',self_id:Number(bot),message_type:kind,user_id:Number(owner),group_id:kind==='group'?Number(group):undefined,
    message_id:Number(id),time:Math.ceil(Date.now()/1000),message:segments,sender:{nickname:'测试主人'}};
}

test('QQ private text flows through real DSH and keeps target and receipt',async t=>{
  const h=await setup();t.after(h.stop);h.emit(message('1'));
  await until(()=>h.platform.sent.length===1);await h.core.whenIdle();
  assert.equal(h.platform.sent[0]?.user_id,Number(owner));
  assert.equal(h.core.journal.list()[0]?.state,'delivered');
  assert.equal(h.ctx.dafeiyuQQ.getStatus().counters.accepted,1);
  const input=h.adapter.requests[0]!.messages.flatMap(message=>message.content.filter(block=>block.type==='text').map(block=>block.text)).join('\n');
  const declarations=input.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const capabilities=declarations.find(value=>value.kind==='channel-capabilities');assert.ok(capabilities);assert.deepEqual(capabilities.media,{input:false,output:false,localStickers:false});assert.equal(capabilities.observation.enabled,false);
});
test('QQ rejects other self IDs, private senders, groups and self messages before model input',async t=>{
  const h=await setup();t.after(h.stop);
  h.emit({...message('1'),self_id:12345});h.emit({...message('2'),user_id:11111});h.emit({...message('3','group'),group_id:22222});h.emit({...message('4'),user_id:Number(bot)});
  await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===4);
  assert.equal(h.adapter.requests.length,0);assert.equal(h.platform.sent.length,0);
});
test('ordinary group chat is passive; real at triggers only the allowed group',async t=>{
  const h=await setup();t.after(h.stop);h.emit(message('1','group'));
  await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===1);assert.equal(h.adapter.requests.length,0);
  h.emit(message('2','group',[{type:'at',data:{qq:bot}},{type:'text',data:{text:'回答测试'}}]));
  await until(()=>h.platform.sent.length===1);await h.core.whenIdle();
  assert.equal(h.platform.sent[0]?.group_id,Number(group));assert.match(JSON.stringify(h.platform.sent[0]),/"reply"/);
});
test('signed quote IDs resolve only in their own conversation and can trigger replies to the bot',async t=>{
  const h=await setup();t.after(h.stop);
  h.emit(message('1','group',[{type:'at',data:{qq:bot}},{type:'text',data:{text:'first'}}]));await until(()=>h.platform.sent.length===1);await h.core.whenIdle();
  h.emit(message('2','group',[{type:'reply',data:{id:'-1000'}},{type:'text',data:{text:'继续'}}]));await until(()=>h.platform.sent.length===2);await h.core.whenIdle();
  assert.match(JSON.stringify(h.adapter.requests.at(-1)),/同一会话的引用消息/);
  h.emit(message('3','private',[{type:'reply',data:{id:'-1000'}},{type:'text',data:{text:'private'}}]));await until(()=>h.platform.sent.length===3);await h.core.whenIdle();
  assert.match(JSON.stringify(h.adapter.requests.at(-1)),/引用内容未取得/);
});
test('duplicates and connector reload do not repeat a model turn',async t=>{
  const h=await setup();t.after(h.stop);h.emit(message('1'));h.emit(message('1'));
  await until(()=>h.platform.sent.length===1);await h.core.whenIdle();
  await h.reload();h.emit(message('1'));await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===1);
  assert.equal(h.adapter.requests.length,1);assert.equal(h.platform.sent.length,1);
});
test('wrong login identity refuses connection before receiving any messages',async t=>{
  const h=await setup('12345');t.after(h.stop);
  assert.equal(h.ctx.dafeiyuQQ.getStatus().state,'rejected');assert.equal(h.wss.clients.size,0);assert.equal(h.adapter.requests.length,0);
});
test('account changes before delivery prevent an outgoing request',async t=>{
  const h=await setup();t.after(h.stop);h.platform.identity='12345';h.emit(message('1'));
  await until(()=>h.core.journal.list()[0]?.state==='reply-ready');
  assert.equal(h.platform.sent.length,0);
});
test('lost send response is unknown and not automatically retried',async t=>{
  const h=await setup();t.after(h.stop);h.platform.loseResponse=true;h.emit(message('1'));
  await until(()=>h.core.journal.list()[0]?.state==='uncertain');
  assert.equal(h.platform.sent.length,1);assert.equal(h.adapter.requests.length,1);
});
test('event socket reconnect verifies identity and records a possible gap',async t=>{
  const h=await setup();t.after(h.stop);for(const ws of h.wss.clients)ws.terminate();
  await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.reconnects>0&&h.ctx.dafeiyuQQ.getStatus().state==='online');
  const route=JSON.stringify(['dafeiyu','qq',bot,'local','__transport__']);
  assert.ok(h.core.journal.events(route).some(event=>event.type==='connection.closed'&&event.data.code==='EVENT_GAP_POSSIBLE'));
});
test('unsupported content is explicitly represented without invented vision',async t=>{
  const h=await setup();t.after(h.stop);h.emit(message('1','private',[{type:'image',data:{file:'not-a-real-image'}}]));
  await until(()=>h.platform.sent.length===1);await h.core.whenIdle();
  assert.match(JSON.stringify(h.adapter.requests[0]),/暂不支持的消息类型 image/);
  assert.equal(h.ctx.dafeiyuQQ.getStatus().counters.unsupported,1);
});

test('configured Chinese address triggers a group turn without treating a matching nickname or quoted address as input',async t=>{
  const h=await setup(bot,{naturalNames:['大肥鱼','蓝色大肥鱼']});t.after(h.stop);
  h.emit({...message('1','group'),sender:{nickname:'大肥鱼'}});
  h.emit(message('2','group',[{type:'text',data:{text:'“@大肥鱼 你好”是个例子'}}]));
  await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===2);assert.equal(h.adapter.requests.length,0);
  h.emit({...message('3','group',[{type:'text',data:{text:'蓝色大肥鱼你怎么看'}}]),user_id:11223344,sender:{nickname:'虚构群成员'}});
  await until(()=>h.platform.sent.length===1);await h.core.whenIdle();
  assert.equal(h.core.journal.list()[0]?.message.sender.id,'11223344');assert.equal(h.platform.groupCalls,1);
});

test('synchronized membership restricts ingress and rechecks the group after a reply has started rendering',async t=>{
  let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
  const h=await setup(bot,{groupSync:{enabled:true}},async()=>{entered();await gate;return textReply('虚构回复');});t.after(h.stop);
  assert.deepEqual(h.ctx.dafeiyuQQ.getStatus().groupSync.effectiveIds,[group]);assert.equal(h.adapter.requests.length,0);
  h.emit(message('1','group',[{type:'at',data:{qq:bot}},{type:'text',data:{text:'测试'}}]));await started;
  h.platform.groups=[];await h.ctx.dafeiyuQQ.refreshGroups();release();await h.core.whenIdle();assert.equal(h.platform.sent.length,0);
  h.emit(message('2','group',[{type:'at',data:{qq:bot}}]));await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===2);assert.equal(h.adapter.requests.length,1);
});

test('failed group refresh after connector reload cannot authorize persisted group membership but private chat stays available',async t=>{
  const h=await setup(bot,{groupSync:{enabled:true,mode:'joined'}});t.after(h.stop);h.platform.failGroups=true;await h.reload();
  const status=h.ctx.dafeiyuQQ.getStatus().groupSync;assert.equal(status.state,'unavailable');assert.equal(status.verifiedThisProcess,false);assert.deepEqual(status.effectiveIds,[]);
  h.emit(message('1','group',[{type:'at',data:{qq:bot}}]));await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===1);assert.equal(h.adapter.requests.length,0);
  h.emit(message('2'));await until(()=>h.platform.sent.length===1);await h.core.whenIdle();assert.equal(h.platform.sent[0]?.user_id,Number(owner));
});

test('assistant groups ignore mentions, natural addresses and passive messages before cache or model input',async t=>{
  const h=await setup(bot,{naturalNames:['大肥鱼']});t.after(h.stop);
  h.platform.groups[0]!.msgMask=2;await h.ctx.dafeiyuQQ.refreshGroups();
  assert.deepEqual(h.ctx.dafeiyuQQ.getStatus().groupSync.assistantIds,[group]);
  h.emit(message('101','group',[{type:'at',data:{qq:bot}}]));
  h.emit(message('102','group',[{type:'text',data:{text:'大肥鱼，请看看'}}]));
  h.emit(message('103','group',[{type:'text',data:{text:'忽略期间的普通消息'}}]));
  await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===3);await h.core.whenIdle();
  assert.equal(h.adapter.requests.length,0);assert.equal(h.platform.sent.length,0);
  const db=new DatabaseSync(join(h.config.dataDir,'qq.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT count(*) AS n FROM messages WHERE id IN (?, ?, ?)').get('101','102','103')?.n,0);}finally{db.close();}
  h.emit(message('104'));await until(()=>h.platform.sent.length===1);await h.core.whenIdle();assert.equal(h.platform.sent[0]?.user_id,Number(owner));
});

test('resume and restart reject delayed ignored messages while preserving prior session and cache records',async t=>{
  const h=await setup();t.after(h.stop);
  h.emit(message('201','group',[{type:'at',data:{qq:bot}},{type:'text',data:{text:'此前的正常会话'}}]));
  await until(()=>h.platform.sent.length===1);await h.core.whenIdle();const session=h.core.journal.list()[0]!.sessionId;
  h.platform.groups[0]!.msgMask=2;await h.ctx.dafeiyuQQ.refreshGroups();
  const old={...message('202','group',[{type:'at',data:{qq:bot}}]),time:Math.floor(Date.now()/1000)-5};h.emit(old);
  await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===2);
  h.platform.groups[0]!.msgMask=1;await h.ctx.dafeiyuQQ.refreshGroups();h.emit(old);
  await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===3);await h.core.whenIdle();assert.equal(h.adapter.requests.length,1);
  await h.reload();h.emit({...old,message_id:203});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===1);
  h.emit({...message('204','group',[{type:'at',data:{qq:bot}}]),time:Math.ceil(Date.now()/1000)+1});
  await until(()=>h.platform.sent.length===2);await h.core.whenIdle();assert.equal(h.adapter.requests.length,2);
  assert.ok(h.core.journal.list().every(item=>item.sessionId===session));
  const db=new DatabaseSync(join(h.config.dataDir,'qq.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT count(*) AS n FROM messages WHERE id=?').get('201')?.n,1);assert.equal(db.prepare('SELECT count(*) AS n FROM messages WHERE id IN (?, ?)').get('202','203')?.n,0);}finally{db.close();}
});

test('assistant transition cancels running and queued work even when the group resumes before processing settles',async t=>{
  let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const h=await setup(bot,{},async()=>{entered();await gate;return textReply('只允许新代次发送');});t.after(h.stop);
  h.emit(message('301','group',[{type:'at',data:{qq:bot}}]));await started;
  h.emit(message('302','group',[{type:'at',data:{qq:bot}}]));await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.accepted===2);
  h.platform.groups[0]!.msgMask=2;await h.ctx.dafeiyuQQ.refreshGroups();
  h.platform.groups[0]!.msgMask=1;await h.ctx.dafeiyuQQ.refreshGroups();release();await h.core.whenIdle();
  assert.equal(h.platform.sent.length,0);assert.equal(h.adapter.requests.length,1);assert.ok(h.core.journal.list().every(item=>item.state==='failed'));
  h.emit({...message('303','group',[{type:'at',data:{qq:bot}}]),time:Math.ceil(Date.now()/1000)+1});
  await until(()=>h.platform.sent.length===1);await h.core.whenIdle();assert.equal(h.adapter.requests.length,2);
});

test('unknown receive settings and explicitly disabled synchronization cannot reopen static group access',async t=>{
  const h=await setup();t.after(h.stop);h.platform.groups[0]!.msgMask=null;await h.ctx.dafeiyuQQ.refreshGroups();
  assert.equal(h.ctx.dafeiyuQQ.getStatus().groupSync.error,'GROUP_SETTINGS_UNKNOWN');assert.deepEqual(h.ctx.dafeiyuQQ.getStatus().groupSync.effectiveIds,[]);
  h.emit(message('401','group',[{type:'at',data:{qq:bot}}]));await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===1);assert.equal(h.adapter.requests.length,0);
  const disabled=await setup(bot,{groupSync:{enabled:false}});t.after(disabled.stop);
  disabled.emit(message('402','group',[{type:'at',data:{qq:bot}}]));await until(()=>disabled.ctx.dafeiyuQQ.getStatus().counters.received===1);
  assert.equal(disabled.platform.groupCalls,0);assert.equal(disabled.adapter.requests.length,0);
});
