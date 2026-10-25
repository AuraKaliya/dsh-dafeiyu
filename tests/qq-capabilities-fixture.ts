import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile,mkdir,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { syntheticPcm } from './media-pcm-fixture.js';
import { join,resolve,relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import * as Timeline from '@dafeiyu/timeline';
import * as Memory from '@dafeiyu/memory';
import * as QQ from '@dafeiyu/channel-qq';
import * as Media from '@dafeiyu/media';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { StreamChunk,LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
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

export async function qqCapabilityFixture({tasks=false,extraTaskActions=[],extraConversationActions=[],extraTaskResources=[],explorationResources,deliverResults=false,existingRoot,media=false,audio=false,voiceDirectives=false,mediaSend=false,tts=false}:{tasks?:boolean;extraTaskActions?:string[];extraConversationActions?:string[];extraTaskResources?:Conversation[];explorationResources?:Conversation[];deliverResults?:boolean;existingRoot?:string;media?:boolean;audio?:boolean;voiceDirectives?:boolean;mediaSend?:boolean;tts?:boolean}={}){
  const scratch=testTempDir();if(existingRoot){const path=relative(resolve(process.env.DAFEIYU_TEST_RUN!),resolve(existingRoot));if(path.startsWith('..')||/^[A-Za-z]:/.test(path))throw new Error('FIXTURE_ROOT_OUTSIDE_MANAGED_RUN');}
  const root=existingRoot??await mkdtemp(join(scratch,'dafeiyu-qq-capabilities-')),tokenFile=join(root,'token'),token='fictional-capability-test-token-no-real-login';await writeFile(tokenFile,token);
  const platform={sent:[] as Record<string,unknown>[],groups:[{group_id:Number(group),group_name:'虚构一群'},{group_id:Number(otherGroup),group_name:'虚构二群'}],identity:bot,loseAt:0,
    mediaFiles:new Map<string,string>(),mediaCalls:[] as {action:string;params:unknown}[],visionReads:0,
    afterVisionRead:async():Promise<void>=>{},
    transcript:'请整理这段虚构讨论',speechDetected:true,
    ttsInputs:[] as string[],ttsFail:false,
    afterSend:async(_count:number):Promise<void>=>{},beforeVerify:async():Promise<void>=>{}};
  const server=createServer(async(req,res)=>{if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}
    let raw='';for await(const bytes of req)raw+=String(bytes);let data:unknown;
    if(req.url==='/get_login_info'){await platform.beforeVerify();data={user_id:Number(platform.identity)};}
    else if(req.url==='/get_status')data={online:true};
    else if(req.url==='/get_group_list')data=platform.groups;
    else if(['/get_image','/get_record','/get_file'].includes(req.url??'')){const params=z.object({file:z.string().optional(),file_id:z.string().optional()}).parse(JSON.parse(raw));platform.mediaCalls.push({action:req.url!,params:JSON.parse(raw)});const file=platform.mediaFiles.get(params.file??params.file_id??'');if(!file){res.writeHead(404).end();return;}data={file};}
    else if(req.url==='/send_private_msg'||req.url==='/send_group_msg'){platform.sent.push(z.record(z.string(),z.unknown()).parse(JSON.parse(raw)));data={message_id:-platform.sent.length};await platform.afterSend(platform.sent.length);if(platform.loseAt===platform.sent.length){res.destroy();return;}}
    else{res.writeHead(404).end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));});
  const wss=new WebSocketServer({server});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  const closeServer=async()=>{for(const ws of wss.clients)ws.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));};
  let response:Response=()=>textReply('虚构完成');
  const h=await harness(join(root,'core'),request=>response(request),undefined,mediaSend?30000:10000,undefined,undefined,'managed').catch(async error=>{await closeServer();throw error;});
  try {
  await h.ctx.plugin(Query,{path:join(root,'query.sqlite'),openAt:'never'});await h.ctx.plugin(Timeline,{agentId:'dafeiyu'});
  const memory=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(root,'memory'),lifecycleMode:'managed',sourceTracking:true});
  h.core.configureExecution({profileId:'qq-capability-fixture',createStore:true,policies:[
    {id:'conversation',producers:['channel-qq'],actions:[...QQ.QQ_ACTIONS,...(tasks?QQ.QQ_TASK_ACTIONS:[]),...(media?[...QQ.QQ_MEDIA_ACTIONS,...Media.MEDIA_ACTIONS]:[]),...extraConversationActions],allowLocalWrite:true},
    {id:'native',producers:['fixture-native'],actions:[...QQ.QQ_ACTIONS,...(media?[...QQ.QQ_MEDIA_ACTIONS,...Media.MEDIA_ACTIONS]:[])],allowLocalWrite:true,resources:[scene]},
    ...(tasks?[{id:'qq-task',producers:['qq-tasks'],actions:[...QQ.QQ_ACTIONS,'dafeiyu_task_intent','dafeiyu_task_object',...extraTaskActions],allowLocalWrite:true,resources:[{...scene,id:otherGroup},...extraTaskResources]}]:[]),
  ]});
  let mediaFiber:Awaited<ReturnType<typeof h.ctx.plugin>>|undefined;
  if(media){await mkdir(join(root,'onebot-cache'),{recursive:true});
    class Vision extends LlmAdapter{override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,systemPromptUpdate:'in-history',toolUpdate:'in-history',inputModalities:['text','image']};}
      override async *stream(request:GenerateOptions):AsyncIterable<StreamChunk>{const images=request.messages.flatMap(m=>m.content.filter(b=>b.type==='image'));assert.ok(images.length);for(const image of images){await h.ctx.attachments.readImageRequest(image.attachment,{width:1024,height:1024,maxBytes:16*1024**2},request.signal);platform.visionReads++;}await platform.afterVisionRead();
        yield* textReply(JSON.stringify({schemaVersion:1,observations:images.map((_image,index)=>({image:index,description:'回环测试脚本视觉结果',visibleText:[],uncertainties:['未做真实模型验收']})),gaps:[]}));}}
    const modelPath=join(root,'audio-model-fixture'),modelHash=createHash('sha256').update('scripted-model').digest('hex');if(audio)await writeFile(modelPath,'scripted-model');
    const mediaSettings:Media.Config={agentId:'dafeiyu',profileId:'qq-capability-fixture',dataDir:join(root,'core'),createStore:true,
      ffmpeg:process.env.DAFEIYU_TEST_FFMPEG??'D:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffmpeg.exe',ffprobe:process.env.DAFEIYU_TEST_FFPROBE??'D:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffprobe.exe',vision:{provider:'qq-media-fixture',model:'scripted'},documents:{python:process.env.DAFEIYU_TEST_DOCUMENT_PYTHON??'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',pypdfVersion:'6.10.0'},
      ...(audio?{audio:{whisper:{node:process.execPath,moduleDirectory:root,moduleVersion:'1.1.3',model:{path:modelPath,sha256:modelHash}},events:{python:'fixture.exe',model:{path:modelPath,sha256:modelHash},labels:{path:modelPath,sha256:modelHash},onnxruntimeVersion:'fixture',numpyVersion:'fixture'}}}:{}),...(tts?{tts:{powershell:'fixture-speech.exe',voice:'fixture-ordinary-voice'}}:{})};
    h.ctx.llm.registerAdapter(['qq-media-fixture'],new Vision());
    mediaFiber=await h.ctx.plugin({name:'fixture-media',inject:['dafeiyu','llm'],apply:(context:Context)=>{new Media.MediaService(context,mediaSettings,{...(audio?{audioWorker:{run:async spec=>{const request=z.object({input:z.string(),inputSha256:z.string(),samples:z.number()}).parse(JSON.parse(await readFile(spec.arguments[1]!,'utf8')));assert.equal(createHash('sha256').update(await readFile(request.input)).digest('hex'),request.inputSha256);
      const result=spec.arguments[0]!.endsWith('whisper.cjs')?{schemaVersion:1,kind:'asr',inputSha256:request.inputSha256,samples:request.samples,backend:'whisper.node',version:'1.1.3',modelSha256:modelHash,completed:true,segments:[{startMs:0,endMs:request.samples/16,text:platform.transcript}]}:
        {schemaVersion:1,kind:'events',inputSha256:request.inputSha256,samples:request.samples,backend:'yamnet-onnx',modelSha256:modelHash,labelsSha256:modelHash,onnxruntimeVersion:'fixture',numpyVersion:'fixture',windows:[{startMs:0,endMs:request.samples/16,scores:[{label:platform.speechDetected?'Speech':'Silence',score:0.9}]}]};
      return {stdout:Buffer.from(JSON.stringify(result)),stderr:Buffer.alloc(0),peakCommitBytes:100,memoryLimitBytes:spec.memoryBytes};}}}:{}),...(tts?{ttsWorker:{run:async spec=>{const input=z.object({text:z.string(),voice:z.literal('fixture-ordinary-voice')}).parse(JSON.parse(await readFile(spec.arguments.at(-1)!,'utf8')));platform.ttsInputs.push(input.text);if(platform.ttsFail)throw new Error('MEDIA_TTS_FIXTURE_FAILURE');return {stdout:syntheticPcm().subarray(44),stderr:Buffer.alloc(0),peakCommitBytes:100,memoryLimitBytes:spec.memoryBytes};}}}:{})});}});
    await h.ctx.dafeiyuMedia.recover();h.ctx.dafeiyuMedia.activate();}
  const config:QQ.Config={agentId:'dafeiyu',botId:bot,ownerId:owner,groupIds:[group,otherGroup],httpURL:`http://127.0.0.1:${address.port}/`,wsURL:`ws://127.0.0.1:${address.port}/`,
    tokenFile,dataDir:join(root,'qq'),lifecycleMode:'managed',requestTimeoutMs:mediaSend?5000:500,reconnectMs:100,groupSync:{enabled:true,mode:'allowlist'},capabilities:{enabled:true},tasks:{enabled:tasks,deliverResults,...(explorationResources?{explorationResources}:{})},naturalNames:['大肥鱼'],...(media?{media:{enabled:true,sendEnabled:mediaSend,cacheRoots:[join(root,'onebot-cache')],voiceDirectives}}:{})};
  // Unbound v2 cache is deliberately retained, but must never appear in new account-bound pages.
  const old=new QQ.QqStore(join(root,'qq','qq.sqlite'));old.remember(JSON.stringify(['group',group]),'900',owner,'UNBOUND_CACHE_SENTINEL');old.close();
  let fiber=await h.ctx.plugin(QQ,config);
  h.ctx.dafeiyuMemory.recover();h.ctx.dafeiyuMemory.activate();await h.core.recoverExecutions();h.core.recover();h.core.activate({deferWork:true});
  const ready=async()=>{await h.ctx.dafeiyuQQ.start();await until(()=>h.ctx.dafeiyuQQ.getStatus().state==='online'&&wss.clients.size>0);};await ready();h.core.activate();
  const emit=(event:object)=>{for(const ws of wss.clients)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(event));};
  let nextId=1;
  const message=async(text:string,{target=scene,trigger=false,media=false,id=String(nextId++),sender=owner}:{target?:Conversation;trigger?:boolean;media?:boolean;id?:string;sender?:string}={})=>{
    const event={post_type:'message',self_id:Number(bot),message_id:Number(id),message_type:target.kind,user_id:Number(sender),...(target.kind==='group'?{group_id:Number(target.id)}:{}),time:1792886400,
      message:[...(trigger&&target.kind==='group'?[{type:'at',data:{qq:bot}}]:[]),{type:'text',data:{text}},...(media?[{type:'image',data:{url:'https://invalid.example/fictional-image'}}]:[])],sender:{nickname:'虚构主人'}};
    const count=h.ctx.dafeiyuQQ.getStatus().counters.received;emit(event);await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>count);await h.core.whenIdle();return {id,event};};
  const rows=()=>{const db=new DatabaseSync(join(root,'memory','memory.sqlite'),{readOnly:true});try{return {
    memories:db.prepare('SELECT r.body,b.body AS boundary FROM memory_items i JOIN memory_revisions r ON r.id=i.id JOIN memory_boundaries b ON b.id=i.id').all(),
    observations:db.prepare('SELECT body FROM capability_observations').all(),decisions:db.prepare('SELECT receipt FROM capability_selections').all(),
  };}finally{db.close();}};
  return {...h,root,platform,rows,emit,message,setResponse:(next:Response)=>{response=next;},
    native:async(requestId:string)=>{const port=h.core.executionProducer('fixture-native'),accepted=port.submitTask({requestId,title:'虚构QQ浏览任务',goal:'只读取获准缓存并选择记忆',policyId:'native'});await h.core.whenIdle();return {...accepted,status:port.status(accepted.run)};},
    reload:async()=>{await fiber.dispose();fiber=await h.ctx.plugin(QQ,config);await ready();},
    close:async()=>{try{await h.core.whenIdle();await fiber.dispose();await mediaFiber?.dispose();await memory.dispose();await h.close();}finally{await closeServer();}},
  };
  } catch(error) {try{await h.ctx.fiber.dispose();}finally{await closeServer();}throw error;}
}
