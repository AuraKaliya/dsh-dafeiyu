import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import * as Timeline from '@dafeiyu/timeline';
import * as Memory from '@dafeiyu/memory';
import * as QQ from '@dafeiyu/channel-qq';
import { ActionOutcomeSchema } from '@dafeiyu/contracts';
import type { Conversation } from '@dafeiyu/contracts';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { harness, textReply } from './harness.js';
import type { Response } from './harness.js';
import { testTempDir } from './test-temp.js';

export const bot='12345678', owner='87654321', group='11223344', otherGroup='22334455';
export const scene:Conversation={channel:'qq',account:bot,kind:'group',id:group};
export const privateScene:Conversation={...scene,kind:'private',id:owner};
export async function until(predicate:()=>boolean){const deadline=Date.now()+5000;while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate(),'QQ fixture condition timed out');}
export function outcomes(request:GenerateOptions){return request.messages.flatMap(message=>message.role==='tool'?message.content.flatMap(block=>{
  if(block.type!=='text')return [];try{const parsed=ActionOutcomeSchema.safeParse(JSON.parse(block.text));return parsed.success?[parsed.data]:[];}catch{return [];}
}):[]);}
const browseData=z.object({snapshotId:z.uuid(),nextCursor:z.uuid().nullable(),page:z.record(z.string(),z.json()).and(z.object({messages:z.array(z.object({id:z.string(),text:z.string(),occurredAt:z.string().nullable(),unsupported:z.array(z.string())})),limitations:z.array(z.string())}))});
export function lastPage(request:GenerateOptions){const pages=outcomes(request).flatMap(outcome=>{const result=browseData.safeParse(outcome.data);return result.success?[result.data]:[];});assert.ok(pages.length,'model must actually see a QQ page');return pages.at(-1)!;}

export async function qqCapabilityFixture(){
  const root=await mkdtemp(join(testTempDir(),'dafeiyu-qq-capabilities-')),tokenFile=join(root,'token'),token='fictional-capability-test-token-no-real-login';await writeFile(tokenFile,token);
  const platform={sent:[] as Record<string,unknown>[],groups:[{group_id:Number(group),group_name:'虚构一群'},{group_id:Number(otherGroup),group_name:'虚构二群'}],identity:bot};
  const server=createServer(async(req,res)=>{if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}
    let raw='';for await(const bytes of req)raw+=String(bytes);let data:unknown;
    if(req.url==='/get_login_info')data={user_id:Number(platform.identity)};
    else if(req.url==='/get_status')data={online:true};
    else if(req.url==='/get_group_list')data=platform.groups;
    else if(req.url==='/send_private_msg'||req.url==='/send_group_msg'){platform.sent.push(z.record(z.string(),z.unknown()).parse(JSON.parse(raw)));data={message_id:-platform.sent.length};}
    else{res.writeHead(404).end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));});
  const wss=new WebSocketServer({server});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  const closeServer=async()=>{for(const ws of wss.clients)ws.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));};
  let response:Response=()=>textReply('虚构完成');
  const h=await harness(join(root,'core'),request=>response(request),undefined,10000,undefined,undefined,'managed').catch(async error=>{await closeServer();throw error;});
  try {
  await h.ctx.plugin(Query,{path:join(root,'query.sqlite'),openAt:'never'});await h.ctx.plugin(Timeline,{agentId:'dafeiyu'});
  const memory=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(root,'memory'),lifecycleMode:'managed',sourceTracking:true});
  h.core.configureExecution({profileId:'qq-capability-fixture',createStore:true,policies:[
    {id:'conversation',producers:['channel-qq'],actions:[...QQ.QQ_ACTIONS],allowLocalWrite:true},
    {id:'native',producers:['fixture-native'],actions:[...QQ.QQ_ACTIONS],allowLocalWrite:true,resources:[scene]},
  ]});
  const config:QQ.Config={agentId:'dafeiyu',botId:bot,ownerId:owner,groupIds:[group,otherGroup],httpURL:`http://127.0.0.1:${address.port}/`,wsURL:`ws://127.0.0.1:${address.port}/`,
    tokenFile,dataDir:join(root,'qq'),lifecycleMode:'managed',requestTimeoutMs:500,reconnectMs:100,groupSync:{enabled:true,mode:'allowlist'},capabilities:{enabled:true}};
  // Unbound v2 cache is deliberately retained, but must never appear in new account-bound pages.
  const old=new QQ.QqStore(join(root,'qq','qq.sqlite'));old.remember(JSON.stringify(['group',group]),'900',owner,'UNBOUND_CACHE_SENTINEL');old.close();
  let fiber=await h.ctx.plugin(QQ,config);
  h.ctx.dafeiyuMemory.recover();h.ctx.dafeiyuMemory.activate();await h.core.recoverExecutions();h.core.recover();h.core.activate();
  const ready=async()=>{await h.ctx.dafeiyuQQ.start();await until(()=>h.ctx.dafeiyuQQ.getStatus().state==='online'&&wss.clients.size>0);};await ready();
  const emit=(event:object)=>{for(const ws of wss.clients)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(event));};
  let nextId=1;
  const message=async(text:string,{target=scene,trigger=false,media=false,id=String(nextId++)}:{target?:Conversation;trigger?:boolean;media?:boolean;id?:string}={})=>{
    const event={post_type:'message',self_id:Number(bot),message_id:Number(id),message_type:target.kind,user_id:Number(owner),...(target.kind==='group'?{group_id:Number(target.id)}:{}),time:1792886400,
      message:[...(trigger&&target.kind==='group'?[{type:'at',data:{qq:bot}}]:[]),{type:'text',data:{text}},...(media?[{type:'image',data:{url:'https://invalid.example/fictional-image'}}]:[])],sender:{nickname:'虚构主人'}};
    const count=h.ctx.dafeiyuQQ.getStatus().counters.received;emit(event);await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>count);await h.core.whenIdle();return {id,event};};
  const rows=()=>{const db=new DatabaseSync(join(root,'memory','memory.sqlite'),{readOnly:true});try{return {
    memories:db.prepare('SELECT r.body,b.body AS boundary FROM memory_items i JOIN memory_revisions r ON r.id=i.id JOIN memory_boundaries b ON b.id=i.id').all(),
    observations:db.prepare('SELECT body FROM capability_observations').all(),decisions:db.prepare('SELECT receipt FROM capability_selections').all(),
  };}finally{db.close();}};
  return {...h,root,platform,rows,emit,message,setResponse:(next:Response)=>{response=next;},
    native:async(requestId:string)=>{const port=h.core.executionProducer('fixture-native'),accepted=port.submitTask({requestId,title:'虚构QQ浏览任务',goal:'只读取获准缓存并选择记忆',policyId:'native'});await h.core.whenIdle();return {...accepted,status:port.status(accepted.run)};},
    reload:async()=>{await fiber.dispose();fiber=await h.ctx.plugin(QQ,config);await ready();},
    close:async()=>{try{await h.core.whenIdle();await fiber.dispose();await memory.dispose();await h.close();}finally{await closeServer();}},
  };
  } catch(error) {try{await h.ctx.fiber.dispose();}finally{await closeServer();}throw error;}
}
