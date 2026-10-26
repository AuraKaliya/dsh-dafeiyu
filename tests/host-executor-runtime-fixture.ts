import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HostRuntimeOptions,ManagedHost } from '@dafeiyu/host';
import type { ExecutorNodeRunOptions,ExecutorNodeRunResult,ServerExecutorDependencies } from '@dafeiyu/server-executor';
import { testTempDir } from './test-temp.js';
import { groupPacket, assertGroupQuery } from './qq-group-packet-fixture.js';

const scenario=process.argv[2];assert.ok(['owner','missing-ports','authority','unknown','drain','cancel'].includes(scenario??''));
const root=await mkdtemp(join(testTempDir(),'host-executor-runtime-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
// DSH modules capture this value during import. Keep all Host/harness runtime imports below this binding.
process.env.DSH_HOME=join(root,'data/core/dsh-home');
const {ManagedHost:Host,loadHostConfig,initializeProfile,inspectHost,owners,readHostStatus}=await import('@dafeiyu/host');
const {ExecutorOutputCollector,ExecutorReceiptSchema,EXECUTOR_SCHEMA_VERSION,executorHash,serverExecutorScene}=await import('@dafeiyu/server-executor');
const {ActionOutcomeSchema,ResourceProofSchema,HostConfigSchema}=await import('@dafeiyu/contracts');
const {QQ_ACTIONS,QQ_TASK_ACTIONS}=await import('@dafeiyu/qq');
const {ScriptedModel,textReply,call}=await import('./harness.js');
const {outcomes}=await import('./qq-capabilities-fixture.js');
const {WebSocketServer,WebSocket}=await import('ws');
const {z}=await import('zod');
const bot='12345678',owner='87654321',stranger='22334455',group='11223344',token='fictional-loopback-executor-host-token';
const action='dafeiyu_server_execute_owner',resultAction='dafeiyu_server_execution_result',statusAction='dafeiyu_server_execution_status';
const h64='1'.repeat(64),finalSentinel='EXECUTOR_FINAL_SELF_REPORT_SENTINEL',opaqueSentinel='OPAQUE_NATIVE_RESULT_SENTINEL';
const personaText='原主人会话整理：执行器自述虚构文件共有三条记录，尚未独立验证。';
const route={provider:'local-test',model:'scripted',reasoningEffort:null,contextWindow:32768,maxOutputTokens:2048,maxRequestBytes:100000};
const external=[{extensionId:'server-executor',actionId:action,actionVersion:'1'}],resource=serverExecutorScene('executor-host-fixture');
let requests=0;const sent:Record<string,unknown>[]=[];
const server=createServer(async(req,res)=>{requests++;if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}
  let raw='';for await(const chunk of req)raw+=String(chunk);let data:unknown;
  if(req.url==='/get_login_info')data={user_id:Number(bot)};else if(req.url==='/get_status')data={online:true};
  else if(req.url==='/get_group_list')data=[{group_id:Number(group),group_name:'虚构测试群'}];
  else if(req.url==='/send_packet'){assertGroupQuery(raw);data=groupPacket([{group_id:Number(group),group_name:'虚构测试群'}]);}
  else if(req.url==='/send_private_msg'||req.url==='/send_group_msg'){sent.push(z.record(z.string(),z.unknown()).parse(JSON.parse(raw)));data={message_id:1000+sent.length};}
  else{res.writeHead(404).end();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));});
const wss=new WebSocketServer({server});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
const command={nodePath:process.execPath,entryPath:join(root,'fictional-executor.js'),cwd:root,args:[],nodeHash:h64,entryHash:h64,profilePath:join(root,'fictional-profile.json'),profileHash:h64,env:{}};
const config={schemaVersion:1,profileId:'executor-host-fixture',agent:{id:'dafeiyu'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite',channels:{'channel-qq':'./data/qq'}},
  persona:{fixedFile:'./persona.md',kind:'test'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},runtime:{turnTimeoutMs:10000,shutdownGraceMs:scenario==='cancel'?50:3000},diagnostics:{snapshotIntervalMs:100},
  plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:'memory',required:true,config:{sourceTracking:true}},
    {id:'server-executor',required:true,config:{command,route,budgetAuthorizationId:'fictional-parent-ledger',resultOwner:{account:bot,ownerId:owner},maxExecutionMs:10000}},
    {id:'channel-qq',required:true,config:{botId:bot,ownerId:owner,groupIds:[group],httpURL:`http://127.0.0.1:${address.port}/`,wsURL:`ws://127.0.0.1:${address.port}/`,tokenFile:'./token',requestTimeoutMs:500,reconnectMs:100,capabilities:{enabled:true},tasks:{enabled:true,deliverResults:true}}}],
  authorityPolicies:[{id:'conversation',producers:['channel-qq'],actions:[...QQ_ACTIONS,...QQ_TASK_ACTIONS],allowLocalWrite:true},
    {id:'qq-task',producers:['qq-tasks'],actions:[action,statusAction,resultAction,'dafeiyu_task_intent','dafeiyu_task_object'],allowLocalWrite:true,externalActions:external,resources:[resource]},
    {id:'local',producers:['host-cli'],actions:[action,statusAction,resultAction],allowLocalWrite:true,externalActions:external,resources:[resource]}]};
await writeFile(join(root,'persona.md'),'虚构Host底色。对外保留来源与未知，不把执行器自述当作已验证事实。');await writeFile(join(root,'token'),token);await writeFile(file,JSON.stringify(config));
const prepared=loadHostConfig(file),initial=inspectHost(prepared,coordination);assert.equal(initial.ready,false);assert.equal(initial.canInitialize,true);assert.ok(initial.codes.includes('HOST_INITIALIZATION_REQUIRED'));
assert.equal(initializeProfile(prepared,coordination).ready,true);const initialized=inspectHost(prepared,coordination);assert.equal(initialized.stores.find(store=>store.name==='executor')?.version,EXECUTOR_SCHEMA_VERSION);
const manifest=JSON.parse(await readFile(join(prepared.paths.core,'host-profile.json'),'utf8'));assert.ok(manifest.requiredStores.includes('executor'));assert.equal(owners(coordination).length,0);
const jsonSettings=config.plugins.find(plugin=>plugin.id==='server-executor')!.config;assert.equal(Object.hasOwn(jsonSettings,'mode'),false);assert.equal(Object.hasOwn(jsonSettings,'run'),false);
assert.throws(()=>HostConfigSchema.parse({...config,serverExecutorDependencies:{mode:'offline'}}));

const dbRead=(name:'runtime'|'executor',sql:string,...params:(string|number)[])=>{const db=new DatabaseSync(join(prepared.paths.core,name+'.sqlite'),{readOnly:true});try{return db.prepare(sql).all(...params);}finally{db.close();}};
const taskRuns=()=>dbRead('runtime',"SELECT r.id,r.state,r.error FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks' ORDER BY r.rowid");
const actionOutcomes=()=>dbRead('runtime',"SELECT action,outcome FROM run_operations WHERE plugin='server-executor' ORDER BY ordinal").map(row=>({action:row.action,outcome:ActionOutcomeSchema.parse(JSON.parse(String(row.outcome)))}));
const receipts=()=>dbRead('executor','SELECT body,body_hash FROM executor_receipts ORDER BY rowid').map(row=>{const receipt=ExecutorReceiptSchema.parse(JSON.parse(String(row.body)));assert.equal(executorHash(receipt),row.body_hash);return receipt;});
const count=(table:string)=>Number(dbRead('executor',`SELECT count(*) AS n FROM ${table}`)[0]?.n??0);
const defer=()=>{let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
const entered=defer(),release=defer();let runnerCalls=0,lastJob='',reserved=0,settled=0;
const dependencies:ServerExecutorDependencies={processControl:{identify:async()=>{throw new Error('No OS process in the explicit offline Host fixture');},terminate:async()=>{throw new Error('No OS termination in this fixture');}},
  loadProfile:async()=>({allowedTools:['read'],guard:()=>{}}),
  budget:{reserve:async()=>{reserved++;return {reservationId:randomUUID(),dispatchPermit:randomUUID()};},settle:async()=>{settled++;return {unknown:false};}},
  run:async(options:ExecutorNodeRunOptions):Promise<ExecutorNodeRunResult>=>{runnerCalls++;lastJob=options.jobId;options.guard();await options.beforeSpawn();
    const process={pid:23456,creationId:'explicit-offline-process',executableHash:options.command.nodeHash};await options.onReady(process);options.guard();assert.deepEqual(options.allowedTools,['read']);
    const invoke={callId:randomUUID(),provider:route.provider,model:route.model,reasoningEffort:null,requestHash:h64,sessionHash:h64,inputBound:route.contextWindow,outputBound:route.maxOutputTokens,requestBytes:100,purpose:'task' as const};
    const permit=await options.budget.reserve({...invoke,authorizationId:options.authorizationId,jobId:options.jobId,deadline:options.deadline},new AbortController().signal);
    const settlement={callId:invoke.callId,reservationId:permit.reservationId,usage:{inputTokens:100,outputTokens:20,uncachedInputTokens:100,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:null},finish:'stop' as const,durationMs:5,error:null};
    await options.budget.settle({...settlement,authorizationId:options.authorizationId,jobId:options.jobId},new AbortController().signal);
    entered.resolve();if(scenario==='drain')await release.promise;
    if(scenario==='cancel')await new Promise<void>(resolve=>{if(options.signal?.aborted)resolve();else options.signal?.addEventListener('abort',()=>resolve(),{once:true});});
    if(scenario==='cancel')assert.throws(options.guard);else options.guard();
    const collector=new ExecutorOutputCollector();for(const message of [{type:'session',sessionId:'offline-executor-session'},{type:'thinking',text:'INTERNAL_FIXTURE_MUST_NOT_BE_SAVED'},{type:'final',text:finalSentinel+'：虚构文件共有三条记录，仅属执行器自述。'}])collector.stdout(Buffer.from(JSON.stringify(message)+'\n'));
    const uncertain=scenario==='unknown'||scenario==='cancel';return {schemaVersion:1,spawned:true,ready:true,finished:scenario!=='cancel',process,exit:scenario==='cancel'?null:{code:0,signal:null},termination:{requested:false,verified:false},output:collector.finish(),
      budget:[{call:invoke,permit,state:'settled',settlement,accountingError:null}],tools:[{call:{callId:randomUUID(),name:'read',sourceCallHash:h64,sessionHash:h64,argumentsHash:h64},permitId:randomUUID(),state:uncertain?'unknown':'completed'}],gaps:scenario==='cancel'?['EXECUTOR_CANCELLED']:[]};}};

let phase='',modelCalls=0,bootCalls=0,chatCalls=0,cliTask=false,rendererCalls=0,verifierCalls=0;
const nativeSteps=new Map<string,number>(),phases:string[]=[];
const adapter=new ScriptedModel(request=>{modelCalls++;assert.ok(['ready','degraded','draining'].includes(phase));const session=String(request.sessionId),wire=JSON.stringify(request.messages);
  if(session.startsWith('dafeiyu-delivery-v3-')){rendererCalls++;assert.ok(!wire.includes(opaqueSentinel));
    if(scenario==='unknown'){assert.ok(!wire.includes(finalSentinel));assert.ok(wire.includes('executor-process-metadata'));return textReply('原主人会话整理：执行效果仍未知，没有自动重试。');}
    assert.ok(wire.includes(finalSentinel),'the persona renderer must actually receive the permitted self-report page');assert.ok(wire.includes('inference'));return textReply(personaText);}
  if(session.startsWith('memory-expression-verify-delivery-')){verifierCalls++;return textReply('{"faithful":true,"issues":[]}');}
  if(session.startsWith('dafeiyu-task-')){
    if(cliTask){assert.equal(request.tools?.some(tool=>tool.name===action),false);return textReply('Host CLI不能冒充QQ主人来源');}
    const step=(nativeSteps.get(session)??0)+1;nativeSteps.set(session,step);
    if(step===1)return call(action,{requestId:'one-executor-job',instruction:'核对虚构文件并报告实际可见结果',sources:[]});
    const previous=outcomes(request).at(-1);assert.ok(previous);
    if(scenario==='unknown'){assert.equal(previous.status,'unknown');assert.equal(previous.effects,'unknown');return textReply(opaqueSentinel+' 执行效果仍未知，不重试');}
    assert.equal(previous.status,'succeeded','a live task must not lose a completed execution/result merely because the Host is draining');
    if(step===2){assert.equal(z.object({page:z.object({kind:z.string()})}).parse(previous.data).page.kind,'executor-process-metadata');return call(resultAction,{jobId:lastJob,section:'final',offset:0,limit:1000});}
    assert.equal(z.object({page:z.object({kind:z.string()})}).parse(previous.data).page.kind,'executor-self-report');return textReply(opaqueSentinel+' 不能直接作为渠道回答');
  }
  chatCalls++;if(chatCalls===1)return call('qq_task_submit',{requestId:'owner-request'});
  if(scenario==='authority'){assert.equal(outcomes(request).at(-1)?.errorCode,'TASK_DIRECTIVE_REQUIRED');return textReply('只有真实主人可提交受托任务');}
  return textReply('已受理虚构任务，完成后会整理回报。');});
const baseOptions:HostRuntimeOptions={coordination,adapter,mode:'daemon',onPhase:(next,current)=>{phase=next;phases.push(next);if(next==='recovering'){assert.equal(modelCalls,bootCalls);assert.equal(runnerCalls,0);assert.equal(current.snapshot().accepting,false);}}};
const options:HostRuntimeOptions={...baseOptions,serverExecutorDependencies:dependencies};
let host:ManagedHost|undefined;
async function until(predicate:()=>boolean,message:string){const deadline=Date.now()+7000;while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate(),message);}
function incoming(nonowner=false){return {post_type:'message',self_id:Number(bot),message_id:100,time:Math.ceil(Date.now()/1000),message_type:nonowner?'group':'private',user_id:Number(nonowner?stranger:owner),...(nonowner?{group_id:Number(group)}:{}),
  message:[...(nonowner?[{type:'at',data:{qq:bot}}]:[]),{type:'text',data:{text:'任务：核对虚构文件并把结果整理给我'}}],sender:{nickname:nonowner?'虚构群友':'虚构主人'}};}
const emit=(message:object)=>{for(const socket of wss.clients)if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
async function awaitConversation(){await until(()=>chatCalls>0,'QQ input must reach the real DSH conversation');await host!.core.whenIdle();}
try{
  if(scenario==='missing-ports'){
    await assert.rejects(()=>Host.start(prepared,baseOptions),/HOST_EXECUTOR_RUNTIME_PORT_REQUIRED/);assert.equal(owners(coordination).length,0);assert.equal(modelCalls,0);assert.equal(runnerCalls,0);assert.equal(count('executor_jobs'),0);
    const failed=JSON.parse(await readFile(join(prepared.paths.core,'host-status.json'),'utf8'));assert.equal(failed.phase,'failed');assert.equal(failed.error,'HOST_EXECUTOR_RUNTIME_PORT_REQUIRED');
    host=await Host.start(prepared,options);assert.equal(host.snapshot().services.executor?.mode,'offline');assert.equal(host.snapshot().accepting,true);
  }else{
    host=await Host.start(prepared,options);assert.equal(host.snapshot().accepting,true);assert.equal(host.snapshot().services.executor?.lifecycle,'active');assert.equal(host.snapshot().services.executor?.mode,'offline');assert.equal(host.snapshot().schemas.executor,EXECUTOR_SCHEMA_VERSION);
    await until(()=>wss.clients.size>0,'the loopback channel must be connected');const firstMessage=incoming(scenario==='authority');emit(firstMessage);
    if(scenario==='authority'){
      await awaitConversation();assert.equal(taskRuns().length,0);assert.equal(runnerCalls,0);cliTask=true;
      const run=await host.run({requestId:'forged-owner',title:'程序任务不是主人',goal:'尝试声称自己是主人任务，不能产生授权',policyId:'local'});assert.equal(run.state,'completed');assert.equal(runnerCalls,0);assert.equal(count('executor_jobs'),0);
    }else if(scenario==='drain'||scenario==='cancel'){
      await until(()=>chatCalls>0,'QQ input must enter before waiting for executor admission');await Promise.race([entered.promise,host.core.whenIdle().then(()=>{throw new Error('Expected executor admission before shutdown');})]);
      const closing=host.close();phase='draining';assert.throws(()=>host!.run({requestId:'late',title:'late',goal:'new work',policyId:'local'}),/HOST_NOT_READY/);if(scenario==='drain')release.resolve();
      await closing;const receipt=receipts()[0];assert.ok(receipt);assert.equal(runnerCalls,1);assert.equal(reserved,1);assert.equal(settled,1);
      if(scenario==='drain'){
        assert.equal(receipt.state,'completed');assert.equal(taskRuns()[0]?.state,'completed');const operations=actionOutcomes();assert.equal(operations.length,2);assert.ok(operations.every(value=>value.outcome.status==='succeeded'));assert.ok(operations.every(value=>value.outcome.data&&typeof value.outcome.data==='object'&&'page'in value.outcome.data));
        const deliveries=()=>dbRead('runtime','SELECT id,run_id,state,material,render_ref,body,credential,receipt,error FROM native_deliveries ORDER BY rowid');
        const waiting=deliveries();assert.equal(waiting.length,1);const pending=waiting[0]!;assert.equal(pending.run_id,taskRuns()[0]!.id);assert.equal(pending.state,'accepted');
        for(const field of ['material','render_ref','body','credential','receipt','error'])assert.equal(pending[field],null);
        assert.equal(rendererCalls,0);assert.equal(verifierCalls,0);assert.deepEqual(host.snapshot().services.taskDelivery,{total:1,pending:1,sent:0,partial:0,uncertain:0,blocked:0});
        assert.ok(!JSON.stringify(sent).includes(personaText));
        // The ordinary acceptance reply may also be reply-ready when shutdown begins. It is separate from the one native result.
        const journal=new DatabaseSync(join(prepared.paths.core,'journal.sqlite'),{readOnly:true});let acknowledgement:{id:string;text:string},pendingAcknowledgement:number;
        try{const inbox=journal.prepare('SELECT state,reply FROM inbox ORDER BY ordinal').all();assert.equal(inbox.length,1);const row=inbox[0]!;
          assert.ok(['reply-ready','delivered'].includes(String(row.state)));acknowledgement=z.object({id:z.string(),text:z.string().max(4000)}).parse(JSON.parse(String(row.reply)));
          assert.match(acknowledgement.text,/^已受理虚构任务/);pendingAcknowledgement=row.state==='reply-ready'?1:0;
        }finally{journal.close();}
        const qq=new DatabaseSync(join(prepared.paths.channels['channel-qq']!,'qq.sqlite'),{readOnly:true});
        try{const segments=qq.prepare('SELECT state,receipt FROM qq_delivery_segments WHERE reply_id=? ORDER BY position').all(acknowledgement.id);
          if(pendingAcknowledgement){assert.ok(segments.length===0||segments.length===1&&segments[0]!.state==='pending'&&segments[0]!.receipt===null);assert.equal(qq.prepare('SELECT count(*) AS n FROM receipts WHERE reply_id=?').get(acknowledgement.id)?.n,0);}
          else{assert.equal(segments.length,1);assert.equal(segments[0]!.state,'sent');assert.ok(segments[0]!.receipt);}
        }finally{qq.close();}
        const sentText=(value:Record<string,unknown>)=>typeof value.message==='string'?value.message:z.array(z.object({type:z.string(),data:z.record(z.string(),z.unknown())})).parse(value.message)
          .filter(segment=>segment.type==='text').map(segment=>z.object({text:z.string()}).parse(segment.data).text).join('');
        assert.equal(sent.filter(value=>sentText(value)===acknowledgement.text).length,1-pendingAcknowledgement);
        const originalRuns=JSON.stringify(taskRuns()),originalOperations=JSON.stringify(operations),originalReceipts=JSON.stringify(receipts()),originalNativeSteps=JSON.stringify([...nativeSteps]),originalChatCalls=chatCalls,beforeDeliverySent=sent.length;
        bootCalls=modelCalls;
        const recoveryOptions:HostRuntimeOptions={...options,onPhase:(next,current)=>{phase=next;phases.push(next);if(next==='recovering'){
          assert.equal(modelCalls,bootCalls);assert.equal(runnerCalls,1);assert.equal(current.snapshot().accepting,false);
        }}};
        host=await Host.start(prepared,recoveryOptions);await host.core.whenIdle();
        assert.equal(rendererCalls,1);assert.equal(verifierCalls,1);assert.equal(modelCalls,bootCalls+2);assert.equal(chatCalls,originalChatCalls);assert.equal(JSON.stringify([...nativeSteps]),originalNativeSteps);
        assert.equal(runnerCalls,1);assert.equal(reserved,1);assert.equal(settled,1);assert.equal(sent.length,beforeDeliverySent+pendingAcknowledgement+1);
        assert.equal(sent.filter(value=>sentText(value)===acknowledgement.text).length,1);assert.equal(sent.filter(value=>sentText(value)===personaText).length,1);
        assert.ok(sent.every(value=>String(value.user_id)===owner&&[acknowledgement.text,personaText].includes(sentText(value))));
        const delivered=deliveries();assert.equal(delivered.length,1);assert.equal(delivered[0]!.id,pending.id);assert.equal(delivered[0]!.run_id,pending.run_id);assert.equal(delivered[0]!.state,'sent');assert.ok(delivered[0]!.receipt);
        const deliveryText=JSON.stringify(sent.at(-1));assert.ok(deliveryText.includes(personaText));assert.ok(!deliveryText.includes(finalSentinel));assert.ok(!deliveryText.includes(opaqueSentinel));assert.equal(String(sent.at(-1)!.user_id),owner);
        assert.equal(JSON.stringify(taskRuns()),originalRuns);assert.equal(JSON.stringify(actionOutcomes()),originalOperations);assert.equal(JSON.stringify(receipts()),originalReceipts);
        assert.deepEqual(host.snapshot().services.taskDelivery,{total:1,pending:0,sent:1,partial:0,uncertain:0,blocked:0});
        await host.close();assert.equal(owners(coordination).length,0);bootCalls=modelCalls;const sentOnce=sent.length,deliveredState=JSON.stringify(deliveries());
        host=await Host.start(prepared,recoveryOptions);await host.core.whenIdle();
        assert.equal(modelCalls,bootCalls);assert.equal(rendererCalls,1);assert.equal(verifierCalls,1);assert.equal(runnerCalls,1);assert.equal(reserved,1);assert.equal(settled,1);assert.equal(sent.length,sentOnce);
        assert.equal(JSON.stringify([...nativeSteps]),originalNativeSteps);assert.equal(JSON.stringify(taskRuns()),originalRuns);assert.equal(JSON.stringify(actionOutcomes()),originalOperations);assert.equal(JSON.stringify(receipts()),originalReceipts);assert.equal(JSON.stringify(deliveries()),deliveredState);
        await host.close();
      }
      else{assert.equal(receipt.state,'unknown');assert.equal(receipt.effects,'unknown');assert.equal(taskRuns()[0]?.state,'interrupted');assert.equal(actionOutcomes()[0]?.outcome.effects,'unknown');assert.equal(rendererCalls,0);assert.equal(host.snapshot().error,'HOST_DRAIN_CANCELLED');}
      assert.equal(host.snapshot().phase,'stopped');assert.equal(owners(coordination).length,0);
    }else{
      await awaitConversation();assert.equal(runnerCalls,1);assert.equal(reserved,1);assert.equal(settled,1);assert.equal(count('executor_jobs'),1);assert.equal(count('executor_budget_links'),1);
      assert.equal(dbRead('executor','SELECT state FROM executor_budget_links')[0]?.state,'settled');const receipt=receipts()[0];assert.ok(receipt);
      if(scenario==='owner'){
        assert.equal(receipt.state,'completed');assert.equal(taskRuns()[0]?.state,'completed');assert.equal(rendererCalls,1);assert.equal(verifierCalls,1);assert.equal(sent.length,2);
        const wire=JSON.stringify(sent);assert.ok(wire.includes(personaText));assert.ok(!wire.includes(finalSentinel));assert.ok(!wire.includes(opaqueSentinel));assert.ok(sent.every(value=>String(value.user_id)===owner));
        const operations=actionOutcomes();assert.equal(operations.length,2);assert.ok(operations.every(value=>value.outcome.status==='succeeded'));
        const proof=ResourceProofSchema.parse(z.object({proof:ResourceProofSchema}).parse(operations[1]!.outcome.data).proof);assert.equal(proof.scene.channel,'server-executor');
        assert.deepEqual(host.snapshot().services.taskDelivery,{total:1,pending:0,sent:1,partial:0,uncertain:0,blocked:0});
        const snapshot=JSON.stringify(host.snapshot());assert.ok(!snapshot.includes(finalSentinel));assert.ok(!snapshot.includes('INTERNAL_FIXTURE_MUST_NOT_BE_SAVED'));
        const envelope=await readFile(join(prepared.paths.core,receipt.output!.relative),'utf8');assert.ok(!envelope.includes('INTERNAL_FIXTURE_MUST_NOT_BE_SAVED'));
        const before=modelCalls;emit(firstMessage);await new Promise(resolve=>setTimeout(resolve,50));await host.core.whenIdle();assert.equal(modelCalls,before);assert.equal(sent.length,2);
      }else{
        assert.equal(receipt.state,'unknown');assert.equal(taskRuns().length,1);assert.equal(actionOutcomes()[0]?.outcome.effects,'unknown');assert.ok(!JSON.stringify(sent).includes(finalSentinel));await until(()=>host!.snapshot().phase==='degraded','unknown executor job must be reflected in Host diagnostics');
        assert.equal(host.snapshot().plugins.find(plugin=>plugin.id==='server-executor')?.code,'HOST_EXECUTOR_UNCERTAIN');assert.equal(host.snapshot().services.executor?.counts.unknown,1);
      }
      host.publish();assert.equal(readHostStatus(prepared,coordination).snapshot?.schemas.executor,EXECUTOR_SCHEMA_VERSION);const prior=JSON.stringify(receipts()),priorRunState=taskRuns()[0]?.state;
      await host.close();bootCalls=modelCalls;const oldRunnerCalls=runnerCalls,oldSent=sent.length;
      // Recovery checks compare against the prior count; no new job or model request is permitted.
      host=await Host.start(prepared,{...options,onPhase:(next)=>{phase=next;phases.push(next);if(next==='recovering'){assert.equal(modelCalls,bootCalls);assert.equal(runnerCalls,oldRunnerCalls);}}});
      await host.core.whenIdle();assert.equal(modelCalls,bootCalls);assert.equal(runnerCalls,oldRunnerCalls);assert.equal(sent.length,oldSent);assert.equal(JSON.stringify(receipts()),prior);assert.equal(taskRuns()[0]?.state,priorRunState);
      assert.equal(host.snapshot().phase,scenario==='unknown'?'degraded':'ready');
    }
  }
  await host?.close();assert.equal(owners(coordination).length,0);console.log(JSON.stringify({scenario,passed:true,phases,modelCalls,runnerCalls,reserved,settled,loopbackRequests:requests,realDsh:true,realCoreMemory:true,realExecutorProcess:false,realAdministratorProof:false,realPlatform:false,realModel:false,serverAccess:false}));
}finally{release.resolve();await host?.close();for(const socket of wss.clients)socket.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}
