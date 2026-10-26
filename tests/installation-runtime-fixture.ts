import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { testTempDir } from './test-temp.js';
import { groupPacket, assertGroupQuery } from './qq-group-packet-fixture.js';

const root=await mkdtemp(join(testTempDir(),'installation-runtime-')),file=join(root,'settings.json'),data=join(root,'data');
process.env.DSH_HOME=join(data,'core','dsh-home');
const {prepareInstallation,startInstallation}=await import('dsh-dafeiyu/installation');
const token='synthetic-installation-token-at-least-thirty-two-characters';let sends=0;
const server=createServer(async(request,response)=>{
  assert.equal(request.headers.authorization,'Bearer '+token);
  let raw='';for await(const part of request)raw+=String(part);
  if(request.url==='/send_packet')assertGroupQuery(raw);
  const value=request.url==='/get_login_info'?{user_id:12345678}:request.url==='/get_status'?{online:true}:request.url==='/get_group_list'?[]:request.url==='/send_packet'?groupPacket([]):request.url==='/send_private_msg'?{message_id:++sends}:null;
  response.setHeader('content-type','application/json');response.end(JSON.stringify({status:'ok',retcode:0,data:value}));
});
const wss=new WebSocketServer({server});wss.on('connection',socket=>socket.send(JSON.stringify({post_type:'message',self_id:12345678,message_id:7,message_type:'private',user_id:87654321,time:1793000000,message:[{type:'text',data:{text:'这是虚构的安装连接检查。'}}],sender:{nickname:'虚构用户'}})));
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address!=='string');
const settings={schemaVersion:1,dataDir:data,model:{model:'unused',credentialStore:join(root,'unused.yaml')},qq:{botId:'12345678',ownerId:'87654321',tokenFile:join(root,'onebot.token'),httpURL:`http://127.0.0.1:${address.port}/`,wsURL:`ws://127.0.0.1:${address.port}/`}};
await writeFile(file,JSON.stringify(settings));await writeFile(settings.qq.tokenFile,token);
const options={scripted:true,foundationTemplate:resolve('profiles/persona.foundation.md')};let host:Awaited<ReturnType<typeof startInstallation>>|undefined;
try{
  const prepared=prepareInstallation(file,options);assert.equal(prepared.inspection.ready,true);
  const metadata=await readFile(join(data,'installation.json'),'utf8');
  host=await startInstallation(file,options);assert.equal(host.snapshot().phase,'ready');assert.ok(host.ctx.dafeiyuMemory.growth);assert.equal(host.ctx.dafeiyuMemory.growth,host.ctx.dafeiyuMemory.persona);
  const deadline=Date.now()+6000;while(sends===0&&Date.now()<deadline)await new Promise(done=>setTimeout(done,20));assert.equal(sends,1);
  await assert.rejects(()=>startInstallation(file,options),/STORE_OWNED|RESOURCE_OWNED|ALREADY_OWNED/);
  await host.close('fixture');host=undefined;
  host=await startInstallation(file,options);await new Promise(done=>setTimeout(done,200));assert.equal(sends,1);await host.close('fixture');host=undefined;
  assert.equal(await readFile(join(data,'installation.json'),'utf8'),metadata);
  const secondFile=join(root,'second.json');await writeFile(secondFile,JSON.stringify({...settings,dataDir:join(root,'second-data')}));const second=prepareInstallation(secondFile,options);
  assert.notEqual(prepared.meta.agentId,second.meta.agentId);assert.notEqual(prepared.prepared.paths.memory,second.prepared.paths.memory);
  await writeFile(file,JSON.stringify({...settings,qq:{...settings.qq,ownerId:'87654322'}}));assert.throws(()=>prepareInstallation(file,options),/IDENTITY_CHANGED_USE_NEW_DIRECTORY/);
  console.log(JSON.stringify({passed:true,realModel:false,realPlatform:false,serverAccess:false,sends,independentInstances:true}));
}finally{await host?.close('fixture-ended');wss.clients.forEach(socket=>socket.terminate());await new Promise<void>(done=>wss.close(()=>done()));await new Promise<void>(done=>server.close(()=>done()));}
