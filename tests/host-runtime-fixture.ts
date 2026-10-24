import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { HostRuntimeOptions,ManagedHost } from '@dafeiyu/host';
import { DatabaseSync } from 'node:sqlite';

const scenario=process.argv[2],root=await mkdtemp(join(tmpdir(),'dafeiyu-host-runtime-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
process.env.DSH_HOME=join(root,'data/core/dsh-home');
const {ManagedHost:Host,loadHostConfig,initializeProfile,owners}=await import('@dafeiyu/host');
const {ScriptedModel,textReply}=await import('./harness.js');
const {WebSocketServer}=await import('ws');
const token='fictional-host-test-token-with-no-real-login';
const config={schemaVersion:1,profileId:'fixture',agent:{id:'dafeiyu'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite',channels:{} as Record<string,string>},
  modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},runtime:{shutdownGraceMs:scenario==='cancel'?50:1000},diagnostics:{snapshotIntervalMs:100},
  plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:'memory',required:true,config:{}},{id:'channel-simulator',required:false,config:{account:'fixture'}}] as {id:string;required:boolean;config:Record<string,unknown>}[],
  authorityPolicies:[{id:'local',producers:['host-cli'],actions:[] as string[],allowLocalWrite:false}]};
const request={requestId:'one',title:'虚构任务',goal:'PRIVATE_TASK_SENTINEL 仅检验隔离，不对外发送。',policyId:'local'};
let server:ReturnType<typeof createServer>|undefined,wss:InstanceType<typeof WebSocketServer>|undefined,sent=0,platformCalls=0;
if(['optional','required','qq','qq-groups','single'].includes(scenario??'')){
  config.paths.channels['channel-qq']='./data/qq';
  let port=1;
  if(scenario==='qq'||scenario==='qq-groups'){
    server=createServer(async(req,res)=>{platformCalls++;if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}
      let data:unknown;if(req.url==='/get_login_info')data={user_id:12345678};else if(req.url==='/get_status')data={online:true};
      else if(req.url==='/get_group_list'){if(scenario==='qq-groups'){res.writeHead(503).end();return;}data=[{group_id:11223344,group_name:'虚构群'}];}
      else if(req.url==='/send_private_msg'){sent++;data={message_id:100+sent};}else{res.writeHead(404).end();return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));});
    wss=new WebSocketServer({server});wss.on('connection',socket=>socket.send(JSON.stringify({post_type:'message',self_id:12345678,message_id:10,message_type:'private',user_id:87654321,time:1792850000,message:[{type:'text',data:{text:'虚构QQ输入'}}],sender:{nickname:'虚构主人'}})));
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');port=address.port;await writeFile(join(root,'token'),token);
  }
  config.plugins.push({id:'channel-qq',required:scenario!=='optional',config:{botId:'12345678',ownerId:'87654321',groupIds:[],httpURL:`http://127.0.0.1:${port}/`,wsURL:`ws://127.0.0.1:${port}/`,tokenFile:'./token',requestTimeoutMs:200,reconnectMs:100,
    ...(['qq','qq-groups'].includes(scenario??'')?{groupSync:{enabled:true,mode:'joined'},naturalNames:['大肥鱼']}:{} )}});
}
if(scenario==='minimal'){config.plugins=config.plugins.filter(p=>p.id!=='memory');config.plugins.find(p=>p.id==='timeline')!.config={execution:false};config.authorityPolicies=[];}
if(scenario==='policy')config.authorityPolicies[0]!.actions=['missing_action'];
await writeFile(join(root,'persona.md'),'本机虚构底色，不含私人历史。');await writeFile(file,JSON.stringify(config));const prepared=loadHostConfig(file);initializeProfile(prepared,coordination);
let phase='',modelCalls=0,bootCalls=0,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
const adapter=new ScriptedModel(async options=>{modelCalls++;assert.ok(['ready','degraded','draining'].includes(phase));started();
  if(scenario==='drain')await new Promise(resolve=>setTimeout(resolve,100));
  if(scenario==='cancel')await new Promise<void>((resolve,reject)=>{options.signal?.addEventListener('abort',()=>reject(new Error('FIXTURE_CANCELLED')),{once:true});});
  return textReply('虚构的可见完成结果');});
const phases:string[]=[],options:HostRuntimeOptions={coordination,adapter,mode:scenario==='single'?'single-run':'daemon',onPhase:(next,host)=>{phase=next;phases.push(next);
  if(next==='recovering'){assert.equal(modelCalls,bootCalls);if(scenario==='fault')throw new Error('FIXTURE_RECOVERY_FAILURE');assert.throws(()=>host.ctx.dafeiyuSimulator.send('room','提前输入',{id:'early'}),/HOST_NOT_READY/);}}};
let host:ManagedHost|undefined;
try{
  if(['required','policy','fault'].includes(scenario??'')){
    await assert.rejects(()=>Host.start(prepared,options),/HOST_QQ_CREDENTIAL_FILE_MISSING|HOST_POLICY_ACTION_UNAVAILABLE|FIXTURE_RECOVERY_FAILURE/);assert.equal(modelCalls,0);assert.equal(owners(coordination).length,0);
    const status=JSON.parse(await readFile(join(prepared.paths.core,'host-status.json'),'utf8'));assert.equal(status.phase,'failed');
  }else{
    host=await Host.start(prepared,options);assert.equal(host.snapshot().accepting,true);
    if(scenario==='optional'){assert.equal(host.snapshot().phase,'degraded');assert.equal(platformCalls,0);assert.equal((await host.run(request)).state,'completed');}
    else if(scenario==='qq'||scenario==='qq-groups'){const deadline=Date.now()+5000;while(sent===0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));await host.core.whenIdle();assert.equal(sent,1);assert.equal(modelCalls,1);
      assert.equal(host.snapshot().services.qq?.groupSync,scenario==='qq'?'current':'unavailable');assert.equal(host.snapshot().phase,scenario==='qq'?'ready':'degraded');
      assert.equal(host.snapshot().services.qq?.effectiveGroups,scenario==='qq'?1:0);}
    else if(scenario==='minimal'){assert.throws(()=>host!.run(request),/HOST_TASK_REPOSITORY_REQUIRED/);host.ctx.dafeiyuSimulator.send('room','虚构聊天',{id:'one'});await host.core.whenIdle();assert.equal(modelCalls,1);assert.ok(!host.snapshot().features.includes('execution.task.v1'));}
    else if(scenario==='drain'||scenario==='cancel'){
      const result=host.run(request);await entered;const closing=host.close();assert.throws(()=>host!.run({...request,requestId:'late'}),/HOST_NOT_READY/);
      const outcome=await result;await closing;assert.equal(outcome.state,scenario==='drain'?'completed':'interrupted');assert.equal(host.snapshot().phase,'stopped');
    }else if(scenario==='backlog'){
      const port=host.core.executionProducer('host-cli'),old=port.submitTask({...request,requestId:'older'});host.ctx.dafeiyuSimulator.send('room','待后续常驻处理的虚构输入',{id:'pending-chat'});
      await host.close();assert.equal(modelCalls,0);bootCalls=modelCalls;host=await Host.start(prepared,{...options,mode:'single-run'});assert.equal(modelCalls,0);assert.equal((await host.run(request)).state,'completed');assert.equal(modelCalls,1);
      const db=new DatabaseSync(join(prepared.paths.core,'runtime.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT state FROM runs WHERE id=?').get(old.run.id)?.state,'accepted');}finally{db.close();}
      await host.close();bootCalls=modelCalls;host=await Host.start(prepared,options);await host.core.whenIdle();assert.equal(modelCalls,3);
      assert.equal(host.ctx.dafeiyuSimulator.deliveries.length,1);
    }else{
      if(scenario==='single'){assert.equal(platformCalls,0);assert.equal(host.snapshot().plugins.find(p=>p.id==='channel-qq')?.state,'disabled');}
      const first=await host.run(request);assert.equal(first.state,'completed');assert.equal(modelCalls,1);assert.equal((await host.run(request)).runId,first.runId);assert.equal(modelCalls,1);
      const snapshot=host.snapshot();assert.ok(snapshot.features.includes('continuity.checkpoint.v1'));assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_TASK_SENTINEL'));
      await host.close();bootCalls=modelCalls;host=await Host.start(prepared,options);assert.equal((await host.run(request)).runId,first.runId);assert.equal(modelCalls,1);
      if(scenario==='normal'){host.ctx.dafeiyuSimulator.send('room','虚构聊天',{id:'chat'});await host.core.whenIdle();assert.equal(host.ctx.dafeiyuSimulator.deliveries.length,1);}
    }
    await host.close();assert.equal(owners(coordination).length,0);
  }
  const db=new DatabaseSync(join(prepared.paths.memory,'memory.sqlite'),{readOnly:true});try{assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,8);}finally{db.close();}
  console.log(JSON.stringify({scenario,passed:true,phases,modelCalls,platformCalls,realModel:false,realPlatform:false,serverAccess:false}));
}finally{await host?.close();if(wss){for(const socket of wss.clients)socket.terminate();await new Promise<void>(resolve=>wss!.close(()=>resolve()));}if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));}
