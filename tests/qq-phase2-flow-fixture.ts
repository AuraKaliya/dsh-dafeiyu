import { mkdtemp,writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { testTempDir } from './test-temp.js';
import { groupPacket, assertGroupQuery } from './qq-group-packet-fixture.js';
const root=await mkdtemp(join(testTempDir(),'dafeiyu-qq-phase2-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
process.env.DSH_HOME=join(root,'data/core/dsh-home');
const {ManagedHost,loadHostConfig,initializeProfile,readHostStatus}=await import('@dafeiyu/host');
const {ScriptedModel,call,textReply}=await import('./harness.js');
const {lastPage}=await import('./qq-capabilities-fixture.js');
const {WebSocketServer}=await import('ws');
const bot='12345678',owner='87654321',group='11223344',peer='22334455',token='fictional-phase-two-token-with-no-real-login';
const scene={channel:'qq',account:bot,kind:'group' as const,id:group},sent:Record<string,unknown>[]=[],final='STAGE2_PUBLIC_FINAL：本群谈及海洋，但相关说法仍待核实。'+'虚构整理细节。'.repeat(750);
let phase='setup',bootstrap=true,chat=0,work=0,mode:'initial'|'peer'|'source'|'cancel'|'after-cancel'='initial',taskId='',runId='';
const server=createServer(async(req,res)=>{if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}let text='';for await(const bytes of req)text+=String(bytes);let data:unknown;
  if(req.url==='/get_login_info')data={user_id:Number(bot)};else if(req.url==='/get_status')data={online:true};
  else if(req.url==='/get_group_list')data=[{group_id:Number(group),group_name:'虚构一群'},{group_id:Number(peer),group_name:'虚构二群'}];
  else if(req.url==='/send_packet'){assertGroupQuery(text);data=groupPacket([{group_id:Number(group),group_name:'虚构一群'},{group_id:Number(peer),group_name:'虚构二群'}]);}
  else if(req.url==='/send_group_msg'){sent.push(JSON.parse(text));data={message_id:-sent.length};}else{res.writeHead(404).end();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));});
const wss=new WebSocketServer({server});
const message=(id:number,room:string,text:string)=>({post_type:'message',self_id:Number(bot),message_id:id,message_type:'group',group_id:Number(room),user_id:Number(owner),time:Math.ceil(Date.now()/1000),message:[{type:'text',data:{text}}]});
wss.on('connection',ws=>{if(!bootstrap)return;bootstrap=false;ws.send(JSON.stringify(message(1,group,'FLOW_PUBLIC_SENTINEL：海洋资料还需要核验。')));ws.send(JSON.stringify(message(2,peer,'FLOW_PEER_PRIVATE_SENTINEL')));ws.send(JSON.stringify(message(10,group,'大肥鱼，帮我整理本群讨论并保留摘要')));});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');await writeFile(join(root,'token'),token);await writeFile(join(root,'persona.md'),'虚构底色：保持好奇、尊重证据，以自然中文交流。');
await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'qq-phase-two',agent:{id:'dafeiyu'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite',channels:{qq:'./data/qq'}},
  modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},runtime:{turnTimeoutMs:15000,shutdownGraceMs:1000},diagnostics:{snapshotIntervalMs:100},
  plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:"memory-growth",required:true,config:{}},
    {id:"qq",required:true,config:{botId:bot,ownerId:owner,groupIds:[group,peer],naturalNames:['大肥鱼'],groupSync:{enabled:true},capabilities:{enabled:true},tasks:{enabled:true,deliverResults:true},httpURL:`http://127.0.0.1:${address.port}/`,wsURL:`ws://127.0.0.1:${address.port}/`,tokenFile:'./token'}}],
  authorityPolicies:[{id:'conversation',producers:['channel-qq'],actions:['qq_groups','qq_browse','qq_observe_select','qq_task_submit','qq_task_status','qq_task_control'],allowLocalWrite:true},
    {id:'qq-task',producers:['qq-tasks'],actions:['qq_groups','qq_browse','qq_observe_select','dafeiyu_task_intent','dafeiyu_task_object'],allowLocalWrite:true}]}));
const prepared=loadHostConfig(file);initializeProfile(prepared,coordination);
const adapter=new ScriptedModel(request=>{assert.ok(['ready','degraded','draining'].includes(phase));const id=String(request.sessionId);
  if(id.startsWith('dafeiyu-delivery-v3-')){const text=JSON.stringify(request.messages);assert.ok(text.includes('FLOW_PUBLIC_SENTINEL'));for(const marker of ['FLOW_PEER_PRIVATE_SENTINEL','INTERNAL_SUMMARY_SENTINEL','EXECUTOR_RAW_SENTINEL'])assert.ok(!text.includes(marker));return textReply(final);}
  if(id.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":true,"issues":[]}');
  if(id.startsWith('dafeiyu-task-')){if(++work===1)return call('qq_groups',{});if(work===2)return call('qq_browse',{requestId:'read',target:scene});if(work===3)return call('qq_observe_select',{requestId:'select',snapshotId:lastPage(request).snapshotId,mode:'summary',text:'INTERNAL_SUMMARY_SENTINEL：这是任务内部推断。',reason:'虚构选择'});return textReply('EXECUTOR_RAW_SENTINEL');}
  if(mode==='initial')return ++chat===1?call('qq_task_submit',{requestId:'source'}):textReply('已受理，会按可核验资料整理。');
  if(mode==='cancel'&&++chat===1)return call('qq_task_control',{requestId:'cancel',taskId,expectedVersion:1,action:'cancel'});
  return textReply('仅根据当前有效资料继续交流。');
});
let host:Awaited<ReturnType<typeof ManagedHost.start>>|undefined;
const options={coordination,adapter,onPhase:(state:string)=>{phase=state;}};
async function wait(predicate:()=>boolean){const deadline=Date.now()+10000;while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate());}
async function send(id:number,room:string,text:string){const count=host!.ctx.dafeiyuQQ.getStatus().counters.received;for(const ws of wss.clients)ws.send(JSON.stringify(message(id,room,text)));await wait(()=>host!.ctx.dafeiyuQQ.getStatus().counters.received>count);await host!.core.whenIdle();}
try{
  host=await ManagedHost.start(prepared,options);await wait(()=>host!.ctx.dafeiyuQQ.getStatus().counters.accepted===1);await host.core.whenIdle();
  assert.equal(host.core.journal.list().length,1);assert.ok(sent.length>=3);assert.ok(sent.every(item=>item.group_id===Number(group)));
  const text=sent.slice(1).map(item=>(item.message as {type:string;data:{text?:string}}[]).filter(segment=>segment.type==='text').map(segment=>segment.data.text).join('')).join('');assert.equal(text,final);
  const runtime=new DatabaseSync(join(prepared.paths.core,'runtime.sqlite'),{readOnly:true});try{const row=runtime.prepare("SELECT r.id,r.definition,r.state FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks'").get()!;assert.equal(row.state,'completed');const definition=JSON.parse(String(row.definition));assert.equal(definition.origin.kind,'native');taskId=definition.taskId;runId=String(row.id);assert.equal(runtime.prepare('SELECT state FROM native_deliveries').get()?.state,'sent');}finally{runtime.close();}
  const memory=new DatabaseSync(join(prepared.paths.memory,'memory.sqlite'),{readOnly:true});try{const item=memory.prepare('SELECT r.body,b.body AS boundary FROM memory_revisions r JOIN memory_boundaries b ON b.id=r.id').get()!;assert.ok(String(item.body).includes('INTERNAL_SUMMARY_SENTINEL'));assert.equal(JSON.parse(String(item.boundary)).externalExpression.kind,'none');assert.equal(memory.prepare('SELECT count(*) AS n FROM capability_selections').get()?.n,1);}finally{memory.close();}
  const calls=adapter.requests.length,sends=sent.length;await host.close();host=await ManagedHost.start(prepared,options);await host.core.whenIdle();assert.equal(adapter.requests.length,calls);assert.equal(sent.length,sends);
  mode='peer';await send(20,peer,'大肥鱼，另一群聊聊');assert.ok(!JSON.stringify(adapter.requests.at(-1)?.messages).includes('STAGE2_PUBLIC_FINAL'));
  mode='source';await send(21,group,'大肥鱼，回顾刚才结果');assert.ok(JSON.stringify(adapter.requests.at(-1)?.messages).includes('STAGE2_PUBLIC_FINAL'));
  mode='cancel';chat=0;await send(22,group,'大肥鱼，取消任务');mode='after-cancel';await send(23,group,'大肥鱼，继续其它话题');assert.ok(!JSON.stringify(adapter.requests.at(-1)?.messages).includes('STAGE2_PUBLIC_FINAL'));
  assert.equal(host.core.messageTaskDeliveryStatus(runId)?.state,'sent');host.publish();const snapshot=readHostStatus(prepared,coordination).snapshot!;assert.equal(snapshot.services.taskDelivery?.sent,1);
  await host.close();console.log(JSON.stringify({passed:true,modelCalls:adapter.requests.length,localPlatformMessages:sent.length,realModel:false,realPlatform:false,serverAccess:false,schemas:snapshot.schemas,restartAdditionalModelCalls:0,restartAdditionalSends:0}));
}finally{await host?.close();for(const ws of wss.clients)ws.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}
