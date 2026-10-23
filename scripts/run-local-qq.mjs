import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const stage = process.argv[2];
if (!['B','C'].includes(stage)) throw new Error('Choose stage B (scripted) or C (real model)');
const root = resolve('.runtime', 'phase2', 'qq-' + stage);
await mkdir(root, { recursive: true });
process.env.DSH_HOME = resolve(root, 'dsh-home');
const { localHost } = await import('./local-host.mjs');
const { Journal } = await import('@dafeiyu/journal');
const { ScriptedModel, textReply } = await import('../build-tests/harness.js');
const QQ = await import('@dafeiyu/channel-qq');
const config = {
  agentId: 'dafeiyu', botId: '1994142241', ownerId: '756013063', groupIds: ['1106067626'],
  httpURL: 'http://127.0.0.1:13000/', wsURL: 'ws://127.0.0.1:13001/',
  tokenFile: resolve('.runtime/phase2/onebot.token'), dataDir: resolve(root, 'qq'),
};
const stopFile = resolve(root, 'stop.request');
try { await access(stopFile); throw new Error('Previous stop.request exists; remove it deliberately before restarting'); }
catch(error) { if(error.code !== 'ENOENT') throw error; }
// One local consumer per test account, including across B/C's independent data directories.
const accountLease = new Journal(resolve('.runtime/phase2/account-1994142241.sqlite'));
let host;
try {
  host = await localHost(root, { simulator: false, realModel: stage === 'C', timeline: process.argv.includes('--timeline'),
    adapter: new ScriptedModel(() => textReply('【本地接入验收·模拟模型】已收到这条消息，文字收发正常。')) });
} catch(error) { accountLease.close(); throw error; }
if(stage==='C')host.core.registerExtension({id:'qq-acceptance-tools',version:'0.2.0',apiVersion:2,agentId:'dafeiyu',actions:[{
  name:'local_acceptance_echo',description:'本地验收用：原样回显text并返回实际回执，无外部副作用。',
  fields:{text:{description:'回显文本',required:true}},
  execute:async args=>({echo:args.text??'',receipt:'qq-local-accepted-42'}),
}]});
const startedAt = new Date().toISOString();
let stopping = false;
let writing = false;
let qqFiber;
async function snapshot(state='running') {
  if(writing)return; writing=true;
  try {
    const data = { stage, state, pid:process.pid, startedAt, at:new Date().toISOString(),
      qq:host.ctx.dafeiyuQQ?.getStatus(), core:host.core.getStatus(), calls:host.calls, faults:host.faults };
    const file=resolve(root,'status.json');await writeFile(file+'.tmp',JSON.stringify(data,null,2)+'\n');await rename(file+'.tmp',file);
  } finally { writing=false; }
}
async function stop() {
  if(stopping)return;stopping=true;clearInterval(timer);
  await snapshot('stopping');
  try { await qqFiber?.dispose();await host.close(); } finally { accountLease.close(); }
  const file=resolve(root,'status.json');const status=JSON.parse(await readFile(file,'utf8'));status.state='stopped';status.stoppedAt=new Date().toISOString();
  await writeFile(file,JSON.stringify(status,null,2)+'\n');process.exitCode=0;
}
try { qqFiber=await host.ctx.plugin(QQ,config); }
catch(error){await host.close();accountLease.close();throw error;}
const timer=setInterval(async()=>{
  if(stopping)return;
  try {await access(stopFile);await stop();}
  catch(error){if(error.code==='ENOENT')await snapshot();else {console.error('Local host state failure');await stop();}}
},2000);
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
await snapshot();console.log(JSON.stringify({stage,pid:process.pid,status:resolve(root,'status.json'),botId:config.botId}));
