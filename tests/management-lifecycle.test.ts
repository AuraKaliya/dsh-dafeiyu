import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {ManagementRuntime} from '../packages/plugin/lib/management-runtime.js';
import type {ManagementRuntimeDependencies} from '../packages/plugin/lib/management-runtime.js';
import {testTempDir} from './test-temp.js';

const token='token-value';
const settingsFile=(root:string)=>{
  const file=join(root,'settings.json');
  writeFileSync(join(root,'token.txt'),token);
  writeFileSync(file,JSON.stringify({schemaVersion:1,dataDir:join(root,'data'),instanceName:'dafeiyu',model:{model:'fixture',credentialStore:join(root,'credentials.json')},
    qq:{botId:'1994142241',ownerId:'756013063',tokenFile:join(root,'token.txt'),httpURL:'http://127.0.0.1:13000/',wsURL:'ws://127.0.0.1:13001/'},activity:{enabled:false}}));
  return file;
};
const onebotReady:typeof fetch=async()=>new Response(JSON.stringify({status:'ok',data:{user_id:1994142241}}),{status:200});
class VirtualTimers {
  private sequence=0;private readonly handles=new Map<number,{fn:()=>void;ms:number}>();
  readonly port={setTimeout:(fn:()=>void,ms:number)=>{const id=++this.sequence;this.handles.set(id,{fn,ms});return id;},clearTimeout:(handle:unknown)=>{this.handles.delete(handle as number);}};
  get pending(){return [...this.handles.values()].map(handle=>handle.ms);}
  runAll(){const entries=[...this.handles.entries()];this.handles.clear();for(const [,handle] of entries)handle.fn();}
}
interface FakeOptions {autoReady?:boolean;answerHealth?:boolean;stopOnCommand?:boolean}
class FakeChild extends EventEmitter {
  readonly pid:number;connected=true;killed=false;readonly sent:Record<string,unknown>[]=[];
  constructor(pid:number,readonly options:FakeOptions={}){super();this.pid=pid;if(options.autoReady)setImmediate(()=>this.ready());}
  send(message:Record<string,unknown>,callback?:(error:Error|null)=>void):boolean{
    this.sent.push(message);
    if(message.type==='stop'&&this.options.stopOnCommand!==false)setImmediate(()=>this.exit());
    if(message.type==='management.request'&&this.options.answerHealth!==false)setImmediate(()=>{if(this.connected)this.emit('message',{type:'management.result',id:String(message.id),ok:true,value:{phase:'ready',pid:this.pid}});});
    callback?.(null);return true;
  }
  ready(){if(this.connected)this.emit('message',{code:'INSTALL_READY'});}
  exit(){if(!this.connected)return;this.connected=false;this.emit('close',0,null);}
  kill(){this.killed=true;this.exit();return true;}
}
const children=(options:FakeOptions={})=>{
  const list:FakeChild[]=[];
  const spawnInstance=()=>{const child=new FakeChild(1000+list.length,{autoReady:true,...options});list.push(child);return child as unknown as ChildProcess;};
  return {list,spawnInstance};
};
const make=(root:string,deps:ManagementRuntimeDependencies={})=>new ManagementRuntime(new Context(),{settingsFile:settingsFile(root),nodePath:process.execPath},{controlWaitMs:20,startTimeoutMs:500,stopTimeoutMs:200,killTimeoutMs:200,healthTimeoutMs:30,fetchImpl:onebotReady,...deps});
const temp=()=>mkdtempSync(join(testTempDir(),'mgmt-'));

test('a repeated start on a running instance returns the same state without a new process or retry',async()=>{
  const root=temp();const {list,spawnInstance}=children();const runtime=make(root,{spawnInstance});
  try{
    const first=await runtime.control('start',{wait:true});
    assert.equal(first.state,'running');assert.equal(first.disposition,'completed');assert.equal(list.length,1);
    const pid=first.pid;
    const second=await runtime.control('start',{wait:true});
    assert.equal(second.state,'running');assert.equal(second.disposition,'completed');assert.equal(second.pid,pid);
    assert.equal(list.length,1,'no second child');assert.equal(second.code,null);assert.equal(second.retry.nextAt,null);assert.equal(second.retryAttempt,0);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('concurrent start requests share one operation and create one child',async()=>{
  const root=temp();const {list,spawnInstance}=children({autoReady:false});const runtime=make(root,{spawnInstance});
  try{
    const [a,b,c]=await Promise.all([runtime.control('start'),runtime.control('start'),runtime.control('start')]);
    assert.equal(list.length,1);
    assert.equal(a.operationId,b.operationId);assert.equal(b.operationId,c.operationId);assert.equal(a.disposition,'accepted');
    assert.equal(b.accepted,true);assert.equal(c.accepted,true);
    list[0]!.ready();await new Promise(done=>setTimeout(done,10));
    const snapshot=runtime.status();
    assert.equal(snapshot.state,'running');assert.equal(snapshot.generation,1);assert.equal(snapshot.pid,1000);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('a stop during a pending QQ wait cancels the operation without spawning an instance or scheduling retry',async()=>{
  const root=temp();const {list,spawnInstance}=children();const timers=new VirtualTimers();
  const hangingFetch:typeof fetch=(_input,init)=>new Promise((_resolve,reject)=>{
    const signal=init?.signal;const fail=()=>reject(new Error('aborted'));
    if(signal?.aborted)fail();else signal?.addEventListener('abort',fail,{once:true});
  });
  const runtime=make(root,{spawnInstance,timers:timers.port,fetchImpl:hangingFetch});
  try{
    const starting=runtime.control('start');
    await new Promise(done=>setTimeout(done,10));
    assert.equal(runtime.status().state,'starting');
    const stopped=await runtime.control('stop',{wait:true});
    assert.equal(stopped.state,'stopped');assert.equal(stopped.disposition,'completed');assert.equal(list.length,0);
    assert.deepEqual(timers.pending,[]);assert.equal(runtime.status().retry.nextAt,null);
    await starting;
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('stop wins during restart and a late ready or close event from the old generation cannot pollute the new one',async()=>{
  const root=temp();const {list,spawnInstance}=children();const runtime=make(root,{spawnInstance});
  try{
    await runtime.control('start',{wait:true});
    const old=list[0]!;
    const restarted=await runtime.control('restart',{wait:true});
    assert.equal(restarted.state,'running');assert.equal(list.length,2);assert.equal(restarted.pid,list[1]!.pid);
    assert.equal(old.connected,false);
    old.ready();old.emit('close',1,null);
    await new Promise(done=>setTimeout(done,5));
    assert.equal(runtime.status().state,'running','a late old-generation event is ignored');
    assert.equal(runtime.status().pid,list[1]!.pid);
    const stopped=await runtime.control('stop',{wait:true});
    assert.equal(stopped.state,'stopped');assert.equal(stopped.disposition,'completed');
    assert.equal(list[1]!.sent.some(message=>message.type==='stop'),true);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('repeated stops and a stop without a child normalise to stopped and clear retry state',async()=>{
  const root=temp();const {list,spawnInstance}=children();const runtime=make(root,{spawnInstance});
  try{
    const first=await runtime.control('stop',{wait:true});
    const second=await runtime.control('stop',{wait:true});
    assert.equal(first.state,'stopped');assert.equal(second.state,'stopped');assert.equal(second.disposition,'completed');assert.equal(list.length,0);
    const failing=make(root,{spawnInstance,fetchImpl:async()=>{throw new Error('offline');},retryDelaysMs:[1],timers:new VirtualTimers().port});
    try{
      await failing.control('start',{wait:true});
      assert.equal(failing.status().state,'waiting');
      const stopped=await failing.control('stop',{wait:true});
      assert.equal(stopped.state,'stopped');assert.equal(stopped.code,null);assert.equal(stopped.retry.nextAt,null);
    }finally{await failing.dispose();}
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('a start request during a stopping child is refused without a second process',async()=>{
  const root=temp();const child=new FakeChild(2000,{autoReady:false,answerHealth:false,stopOnCommand:false});let spawns=0;
  const runtime=make(root,{spawnInstance:()=>{spawns++;return child as unknown as ChildProcess;}});
  try{
    const starting=runtime.control('start');
    await new Promise(done=>setTimeout(done,10));
    assert.equal(runtime.status().state,'starting');
    const stopping=runtime.control('stop');
    await new Promise(done=>setTimeout(done,10));
    assert.equal(runtime.status().state,'stopping');
    const again=await runtime.control('start',{wait:true});
    assert.equal(again.accepted,false);assert.equal(again.disposition,'rejected');assert.equal(again.rejectCode,'MANAGEMENT_STOPPING');
    await stopping;await starting;
    const settled=await runtime.control('stop',{wait:true});
    assert.equal(settled.state,'stopped');assert.equal(spawns,1,'no second child');
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('an instance that never reports ready stays unconfirmed and is recovered through its own IPC channel',async()=>{
  const root=temp();const {list,spawnInstance}=children({autoReady:false,answerHealth:false});const runtime=make(root,{spawnInstance,startTimeoutMs:30});
  try{
    const first=await runtime.control('start',{wait:true});
    assert.equal(first.state,'starting');assert.equal(first.instance,'unconfirmed');assert.equal(first.code,'MANAGEMENT_START_TIMEOUT');assert.equal(list.length,1);
    const second=await runtime.control('start',{wait:true});
    assert.equal(second.accepted,true);assert.equal(second.code,'MANAGEMENT_START_UNCONFIRMED');assert.equal(list.length,1,'never a second instance');
    list[0]!.options.answerHealth=true;
    const status=await runtime.control('status');
    assert.equal(status.state,'running');assert.equal(status.instance,'ready');assert.equal(status.host!==null,true);assert.equal(list.length,1);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('deterministic failures do not enter automatic retry',async()=>{
  const root=temp();const missing=join(root,'absent.json');const timers=new VirtualTimers();
  const runtime=new ManagementRuntime(new Context(),{settingsFile:missing,nodePath:process.execPath},{controlWaitMs:10,retryDelaysMs:[1],timers:timers.port,fetchImpl:onebotReady});
  try{
    const result=await runtime.control('start',{wait:true});
    assert.equal(result.state,'failed');assert.equal(result.code,'INSTALL_CONFIGURATION_REQUIRED');assert.equal(result.disposition,'failed');
    assert.equal(result.retry.nextAt,null);assert.deepEqual(timers.pending,[]);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('an unavailable node executable is reported and not retried',async()=>{
  const root=temp();const timers=new VirtualTimers();
  const spawnInstance=()=>{const child=new FakeChild(3000);setImmediate(()=>{child.emit('error',new Error('ENOENT'));child.exit();});return child as unknown as ChildProcess;};
  const runtime=make(root,{spawnInstance,timers:timers.port,retryDelaysMs:[1]});
  try{
    const result=await runtime.control('start',{wait:true});
    assert.equal(result.state,'failed');assert.equal(result.code,'INSTALL_NODE_UNAVAILABLE');assert.equal(result.retry.nextAt,null);assert.deepEqual(timers.pending,[]);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('a temporary dependency failure retries within bounds and cancels the remaining retries on success',async()=>{
  const root=temp();const {list,spawnInstance}=children();const timers=new VirtualTimers();
  let probes=0;
  const flakyFetch:typeof fetch=async()=>{probes++;if(probes<=1)throw new Error('offline');return new Response(JSON.stringify({status:'ok',data:{user_id:1994142241}}),{status:200});};
  const runtime=make(root,{spawnInstance,timers:timers.port,fetchImpl:flakyFetch,retryDelaysMs:[5,5,5]});
  try{
    const first=await runtime.control('start',{wait:true});
    assert.equal(first.state,'waiting');assert.equal(first.retry.attempt,1);assert.deepEqual(timers.pending,[5]);
    timers.runAll();
    await new Promise(done=>setTimeout(done,20));
    const snapshot=runtime.status();
    assert.equal(snapshot.state,'running');assert.equal(list.length,1);assert.equal(snapshot.retry.nextAt,null);assert.equal(snapshot.retryAttempt,0);
    assert.equal(snapshot.code,null,'the current error is cleared after recovery');
    assert.equal(snapshot.history.some(entry=>entry.code==='ONEBOT_NOT_RUNNING'),true,'the earlier failure remains as diagnosis history');
    assert.deepEqual(timers.pending,[]);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('status queries are read-only and never start a process or a retry',async()=>{
  const root=temp();const {list,spawnInstance}=children();const runtime=make(root,{spawnInstance});
  try{
    const status=await runtime.control('status');
    assert.equal(status.state,'stopped');assert.equal(list.length,0);assert.equal(status.retry.nextAt,null);assert.equal(status.host,null);
    await runtime.control('status');assert.equal(list.length,0);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});

test('a real child process answers its own IPC snapshot and stop',{timeout:9000},async()=>{
  const root=temp();const script=join(root,'child.mjs');
  writeFileSync(script,`process.send?.({code:'INSTALL_READY'});\nprocess.on('message',message=>{if(message?.type==='management.request')process.send({type:'management.result',id:message.id,ok:true,value:{phase:'ready',pid:process.pid}});else if(message?.type==='stop'){process.send({code:'INSTALL_STOPPED'});process.exit(0);}});\nsetInterval(()=>{},1000);\n`);
  const runtime=make(root,{spawnInstance:()=>spawn(process.execPath,[script],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']}),startTimeoutMs:4000,stopTimeoutMs:4000});
  try{
    const started=await runtime.control('start',{wait:true});
    assert.equal(started.state,'running');assert.ok((started.pid??0)>0);assert.equal(started.instance,'ready');
    const status=await runtime.control('status');
    assert.equal((status.host as {phase?:unknown}|null)?.phase,'ready');
    const stopped=await runtime.control('stop',{wait:true});
    assert.equal(stopped.state,'stopped');assert.equal(stopped.pid,null);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});
