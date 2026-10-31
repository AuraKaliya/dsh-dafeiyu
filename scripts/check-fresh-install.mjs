import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

// Real release entry, CLI, SDK, process and stores; loopback fixtures replace platforms.
const flags=new Map();
for(let i=2;i<process.argv.length;i+=2){if(!['--package','--workdir'].includes(process.argv[i])||!process.argv[i+1])throw new Error('FRESH_INSTALL_ARGUMENTS');flags.set(process.argv[i],resolve(process.argv[i+1]));}
const packageRoot=flags.get('--package'),work=flags.get('--workdir');
if(!packageRoot||!work||existsSync(work))throw new Error('FRESH_INSTALL_NEW_WORKDIR_REQUIRED');
const inside=relative(packageRoot,work);if(!inside.startsWith('..'))throw new Error('FRESH_INSTALL_WORKDIR_INSIDE_PACKAGE');
const pkg=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));assert.equal(pkg.name,'dsh-dafeiyu');
const require=createRequire(join(packageRoot,'package.json'));
const outside=Object.keys(pkg.dependencies).filter(name=>!realpathSync(require.resolve(name)).toLowerCase().startsWith(realpathSync(packageRoot).toLowerCase()+'\\'));
assert.deepEqual(outside,[],'Release dependencies must resolve inside its own directory');
const plugin=await import(pathToFileURL(join(packageRoot,pkg.main)).href);assert.equal(typeof plugin.apply,'function');
mkdirSync(work,{recursive:true});
const {WebSocketServer}=require('ws'),counts={modelGenerations:0,platformSends:0,onebotReads:0,requests:{}};
const server=createServer(async(request,response)=>{
  counts.requests[request.url??'unknown']=(counts.requests[request.url??'unknown']??0)+1;let data;
  if(request.url==='/send_packet'){
    let text='';for await(const chunk of request){text+=chunk.toString();if(text.length>8192)break;}
    let packet;try{packet=JSON.parse(text);}catch{}
    if(packet?.cmd!=='OidbSvcTrpcTcp.0xfe5_2'||packet.data!=='08e51f1002220e0a0c0a06180120012801120238016001'||packet.rsp!==true){
      counts.platformSends++;response.writeHead(400);response.end();return;
    }
    data='08e51f100218002200';
  }else request.resume();
  if(request.url==='/send_packet'){/* Fixed read-only group-list query, verified above. */}
  else if(request.url==='/get_login_info')data={user_id:99900001,nickname:'Isolated fixture'};
  else if(['/get_group_list','/get_group_ignore_list','/get_friend_list'].includes(request.url))data=[];
  else if(request.url==='/get_status')data={online:true,good:true};
  else if(request.url==='/get_version_info')data={app_name:'SnowLuma',app_version:'fixture',protocol_version:'v11'};
  else{
    if(/send|delete|set_|upload/.test(request.url??''))counts.platformSends++;
    else counts.modelGenerations++;
    response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({status:'failed',retcode:1,data:null}));return;
  }
  counts.onebotReads++;response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({status:'ok',retcode:0,data}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,websocket=new WebSocketServer({server});
websocket.on('connection',socket=>socket.send(JSON.stringify({post_type:'meta_event',meta_event_type:'lifecycle',sub_type:'connect',self_id:99900001,time:Math.floor(Date.now()/1000)})));
const settings=join(work,'dafeiyu.config.json'),credentials=join(work,'model.credentials.yaml');
writeFileSync(credentials,'version: 1\nrefs:\n  DEEPSEEK_API_KEY: fictional-offline-test-credential\n',{mode:0o600});
writeFileSync(join(work,'onebot.token'),'fictional-onebot-token-0000000000000000',{mode:0o600});
writeFileSync(settings,JSON.stringify({schemaVersion:1,instanceName:'fresh-install-check',dataDir:'./data',dshTools:false,
  model:{model:'deepseek-chat',credentialStore:'./model.credentials.yaml',baseURL:`http://127.0.0.1:${port}/anthropic`},
  qq:{botId:'99900001',ownerId:'99900002',tokenFile:'./onebot.token',httpURL:`http://127.0.0.1:${port}/`,wsURL:`ws://127.0.0.1:${port}/`,groupIds:[],joinedGroups:false,stickers:{enabled:false}},activity:{enabled:false}},null,2));
const cli=join(packageRoot,'bin/dafeiyu.mjs'),env={...process.env,NODE_PATH:'',NODE_OPTIONS:'',DSH_HOME:join(work,'dsh-home')};
const command=mode=>{
  const result=spawnSync(process.execPath,[cli,mode,'--settings',settings],{cwd:work,env,windowsHide:true,encoding:'utf8',timeout:30000});
  if(result.status!==0)throw new Error('FRESH_INSTALL_'+mode.toUpperCase()+'_FAILED '+result.stdout.trim());
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
};
let child;const starts=[];
const stop=async()=>{
  if(!child)return;const current=child;child=undefined;
  if(current.exitCode!==null)return;
  const closed=new Promise(resolve=>current.once('close',resolve));
  if(current.connected)current.send({type:'stop'});
  const timer=setTimeout(()=>current.kill(),15000);
  try{await closed;assert.equal(current.exitCode,0);}finally{clearTimeout(timer);}
};
const start=async()=>{
  child=spawn(process.execPath,[cli,'start','--settings',settings],{cwd:work,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.resume();child.stderr.resume();
  await new Promise((resolve,reject)=>{
    const current=child,timer=setTimeout(()=>reject(new Error('FRESH_INSTALL_READY_TIMEOUT')),30000);
    const message=value=>{if(value?.code==='INSTALL_READY'){clearTimeout(timer);current.off('message',message);resolve();}
      else if(typeof value?.code==='string'&&value.code!=='INSTALL_STOPPED'){clearTimeout(timer);reject(new Error(value.code));}};
    current.on('message',message);current.once('error',reject);current.once('close',()=>{clearTimeout(timer);reject(new Error('FRESH_INSTALL_PROCESS_CLOSED'));});
  });
  const status=command('status');assert.equal(status.online,true);assert.equal(status.snapshot.accepting,true);
  assert.equal(status.snapshot.services.qq.state,'online');
  assert.ok(status.snapshot.plugins.filter(plugin=>plugin.version&&plugin.id!=='model-deepseek').every(plugin=>plugin.version===pkg.version));
  starts.push({pid:child.pid,phase:status.snapshot.phase,online:true,qq:'online'});
};
try{
  assert.equal(command('check').code,'INSTALL_CONFIGURATION_VALID');assert.equal(command('init').code,'INSTALL_INITIALIZED');
  const metadata=join(work,'data/installation.json'),identity=JSON.parse(readFileSync(metadata,'utf8'));
  assert.equal(command('init').code,'INSTALL_INITIALIZED');assert.deepEqual(JSON.parse(readFileSync(metadata,'utf8')),identity);
  await start();await stop();await start();await stop();assert.deepEqual(JSON.parse(readFileSync(metadata,'utf8')),identity);
  const extended=JSON.parse(readFileSync(settings,'utf8'));
  extended.bilibili={capabilities:true};extended.media={ffmpeg:process.execPath,ffprobe:process.execPath};extended.activity.enabled=true;
  writeFileSync(settings,JSON.stringify(extended,null,2));assert.equal(command('init').code,'INSTALL_INITIALIZED');
  const versions={};for(const name of ['runtime','bilibili','media','activity']){const db=new DatabaseSync(join(work,'data/core',name+'.sqlite'),{readOnly:true});try{versions[name]=db.prepare('PRAGMA user_version').get().user_version;}finally{db.close();}}
  assert.equal(versions.bilibili,6);assert.equal(versions.runtime,2);
  extended.activity.enabled=false;writeFileSync(settings,JSON.stringify(extended,null,2));assert.equal(command('init').code,'INSTALL_INITIALIZED');
  await start();await stop();assert.deepEqual(JSON.parse(readFileSync(metadata,'utf8')),identity);
  assert.equal(counts.modelGenerations,0,JSON.stringify(counts));assert.equal(counts.platformSends,0,JSON.stringify(counts));
  const report={passed:true,version:pkg.version,packageRoot,workdir:work,dependencies:Object.keys(pkg.dependencies).length,
    entryImported:true,initialized:true,identityPreserved:true,optionalStores:versions,starts,counts,realPlatforms:false,mediaProcessing:false};
  writeFileSync(join(work,'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
  await stop();for(const client of websocket.clients)client.terminate();await new Promise(resolve=>websocket.close(resolve));await new Promise(resolve=>server.close(resolve));
}
