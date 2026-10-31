import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {Context} from '@deepseek-ai/cordis';
import type {ChildProcess} from 'node:child_process';
import type {ManagementControlResult,ManagementRuntimeSnapshot} from '@dafeiyu/contracts';
import {API_VERSION} from '@dafeiyu/contracts';
import {controlAvailability,controlNotice,controlRequest,createSequenceGuard,lifecycleLabel,pollInterval,unwrapResponse} from '../packages/plugin/lib/management-view.js';
import {RuntimePanel} from '../packages/plugin/client/runtime-panel.js';
import {createManagementDispatch} from '../packages/plugin/lib/management-dispatch.js';
import {ManagementSettings} from '../packages/plugin/lib/management-settings.js';
import {ManagementRuntime} from '../packages/plugin/lib/management-runtime.js';
import {testTempDir} from './test-temp.js';
const require=createRequire(import.meta.url);
const React=require('react') as {createElement:(component:unknown,props:Record<string,unknown>)=>unknown};
const renderToStaticMarkup=(require('react-dom/server') as {renderToStaticMarkup:(element:unknown)=>string}).renderToStaticMarkup;

interface Element {type:unknown;props:Record<string,unknown>}
const isElement=(value:unknown):value is Element=>typeof value==='object'&&value!==null&&'props' in (value as object)&&'type' in (value as object);
function elements(node:unknown,visit:(element:Element)=>void):void{
  if(Array.isArray(node)){for(const child of node)elements(child,visit);return;}
  if(!isElement(node))return;
  visit(node);
  const children=node.props['children'];
  if(children!==undefined)elements(children,visit);
}
function find(tree:unknown,predicate:(element:Element)=>boolean):Element|undefined{
  let found:Element|undefined;elements(tree,element=>{if(!found&&predicate(element))found=element;});return found;
}
const button=(tree:unknown,action:string):Element=>{
  const found=find(tree,element=>element.props['data-action']===action);
  assert.ok(found,'missing button '+action);return found;
};
const snapshot=(overrides:Partial<ManagementRuntimeSnapshot>={}):ManagementRuntimeSnapshot=>({
  state:'stopped',phase:'idle',operationId:null,operation:null,generation:0,pid:null,code:null,codeAt:null,retryAttempt:0,retry:{attempt:0,nextAt:null},
  checkedAt:null,startedAt:null,readyAt:null,instance:'absent',error:null,history:[],capabilities:[],activity:null,...overrides});
const temp=()=>mkdtempSync(join(testTempDir(),'ui-'));
const settingsFile=(root:string)=>{
  writeFileSync(join(root,'token.txt'),'token-value');
  const file=join(root,'settings.json');
  writeFileSync(file,JSON.stringify({schemaVersion:1,dataDir:join(root,'data'),instanceName:'dafeiyu',model:{model:'fixture',credentialStore:join(root,'credentials.json')},
    qq:{botId:'1994142241',ownerId:'756013063',tokenFile:join(root,'token.txt'),httpURL:'http://127.0.0.1:13000/',wsURL:'ws://127.0.0.1:13001/'},activity:{enabled:false}}));
  return file;
};
class FakeChild extends EventEmitter {
  readonly pid:number;connected=true;
  constructor(pid:number){super();this.pid=pid;setImmediate(()=>{if(this.connected)this.emit('message',{code:'INSTALL_READY'});});}
  send(message:Record<string,unknown>,callback?:(error:Error|null)=>void):boolean{
    if(message.type==='stop')setImmediate(()=>{if(!this.connected)return;this.connected=false;this.emit('close',0,null);});
    callback?.(null);return true;
  }
  kill(){if(!this.connected)return true;this.connected=false;this.emit('close',0,null);return true;}
}

test('lifecycle enablement, polling cadence and labels follow the shared snapshot',()=>{
  assert.deepEqual(controlAvailability(snapshot({state:'stopped'})),{start:true,stop:false,restart:false,reason:null});
  assert.deepEqual(controlAvailability(snapshot({state:'running',instance:'ready'})),{start:false,stop:true,restart:true,reason:null});
  assert.deepEqual(controlAvailability(snapshot({state:'starting',phase:'qq'})),{start:false,stop:true,restart:true,reason:'启动进行中'});
  assert.deepEqual(controlAvailability(snapshot({state:'stopping',phase:'stopping'})),{start:false,stop:false,restart:false,reason:'正在停止'});
  assert.equal(controlAvailability(snapshot({state:'failed'})).start,true);
  assert.equal(controlAvailability(snapshot({state:'starting',operationId:'id',operation:{id:'id',action:'start',disposition:'accepted',at:new Date().toISOString(),code:null}})).start,false);
  assert.equal(lifecycleLabel(snapshot({state:'starting',phase:'qq'})),'启动中 · 等待 QQ');
  assert.equal(lifecycleLabel(snapshot({state:'waiting',phase:'qq'})),'等待依赖 · 等待 QQ');
  assert.equal(lifecycleLabel(snapshot({state:'running',phase:'ready'})),'运行中');
  assert.equal(pollInterval(snapshot({state:'running'})),5_000);
  assert.equal(pollInterval(snapshot({state:'starting'})),1_000);
  assert.equal(pollInterval(snapshot({state:'running',operationId:'id'})),1_000);
  assert.equal(pollInterval(null),1_000);
});

test('a refused operation is reported as a failure instead of an outer-protocol success',()=>{
  const refused=controlNotice({accepted:false,disposition:'rejected',rejectCode:'MANAGEMENT_STOPPING',code:null,hostCode:null,operationId:'id'});
  assert.equal(refused?.tone,'error');assert.match(refused?.text??'',/正在停止/);
  const failed=controlNotice({accepted:true,disposition:'failed',code:'INSTALL_CONFIGURATION_REQUIRED',hostCode:null,operationId:'id'});
  assert.equal(failed?.tone,'error');assert.match(failed?.text??'',/配置不完整/);
  const pending=controlNotice({accepted:true,disposition:'accepted',code:'MANAGEMENT_START_UNCONFIRMED',hostCode:null,operationId:'id'});
  assert.equal(pending?.tone,'info');
  assert.equal(controlNotice({accepted:true,disposition:'completed',code:null,hostCode:null,operationId:null}),null);
  assert.throws(()=>unwrapResponse({ok:false,code:'MANAGEMENT_OWNER_REQUIRED',fields:['qq.botId']}),/MANAGEMENT_OWNER_REQUIRED：qq\.botId/);
  assert.equal((unwrapResponse({ok:true,value:{state:'running'}}) as {state:string}).state,'running');
});

test('the sequence guard rejects late responses and never rewinds a newer snapshot',()=>{
  const guard=createSequenceGuard();const first=guard.issue(),second=guard.issue();
  assert.equal(guard.accept(first),false);assert.equal(guard.accept(second),true);
  const third=guard.issue();assert.equal(guard.accept(second),false);assert.equal(guard.accept(third),true);
});

test('the runtime panel disables start while running and renders instance and B站 state separately',()=>{
  const running=snapshot({state:'running',phase:'ready',instance:'ready',generation:2,pid:4321,readyAt:new Date().toISOString(),checkedAt:new Date().toISOString(),
    capabilities:[{id:'qq',state:'ready',owned:false,pid:null,code:null,message:null}]});
  const props={snapshot:running,host:{plugins:[{id:'bilibili',state:'degraded',code:'HOST_BILI_DIAGNOSTIC_REQUIRED'}],services:{bilibili:{diagnosticRequired:true}}},busy:false,notice:'',onControl:()=>{},onRefresh:()=>{}};
  const tree=RuntimePanel(props);
  assert.equal(button(tree,'start').props['disabled'],true);
  assert.equal(button(tree,'stop').props['disabled'],false);
  assert.equal(button(tree,'restart').props['disabled'],false);
  const html=renderToStaticMarkup(React.createElement(RuntimePanel,props));
  assert.match(html,/运行中/);assert.match(html,/实例已就绪/);assert.match(html,/4321/);
  assert.match(html,/B站能力/);assert.match(html,/degraded/);assert.match(html,/HOST_BILI_DIAGNOSTIC_REQUIRED/);
  const stopped=RuntimePanel({snapshot:snapshot(),onControl:()=>{},onRefresh:()=>{}});
  assert.equal(button(stopped,'start').props['disabled'],false);
  assert.equal(button(stopped,'stop').props['disabled'],true);
  const recovered=RuntimePanel({snapshot:snapshot({state:'running',phase:'ready',instance:'ready',history:[{code:'ONEBOT_NOT_RUNNING',at:new Date().toISOString(),phase:'qq'},{code:'MANAGEMENT_START_TIMEOUT',at:new Date().toISOString(),phase:'process'}]}),onControl:()=>{},onRefresh:()=>{}});
  const recoveredHtml=renderToStaticMarkup(React.createElement(RuntimePanel,{snapshot:snapshot({state:'running',phase:'ready',instance:'ready',history:[{code:'ONEBOT_NOT_RUNNING',at:new Date().toISOString(),phase:'qq'}]}),onControl:()=>{},onRefresh:()=>{}}));
  assert.match(recoveredHtml,/历史错误记录/);
  assert.equal(find(recovered,element=>element.props['data-runtime-history']!==undefined)?.props['data-runtime-history'],2);
  assert.match(recoveredHtml,/ONEBOT_NOT_RUNNING/);
});

test('a rendered start button drives the real management protocol into the lifecycle controller',async()=>{
  const root=temp();const file=settingsFile(root);let spawns=0;
  const spawnInstance=()=>{spawns++;return new FakeChild(9000+spawns) as unknown as ChildProcess;};
  const runtime=new ManagementRuntime(new Context(),{settingsFile:file,nodePath:process.execPath},{controlWaitMs:10,startTimeoutMs:1_000,stopTimeoutMs:500,fetchImpl:async()=>new Response(JSON.stringify({status:'ok',data:{user_id:1994142241}}),{status:200}),spawnInstance});
  const dispatch=createManagementDispatch({settings:new ManagementSettings(file),runtime,describe:()=>({apiVersion:API_VERSION,version:'test',modules:[],prompts:[]})});
  /** Same shape as the Client remote: a protocol envelope around the inner result. */
  const request=async(body:Record<string,unknown>)=>({ok:true,value:JSON.stringify(await dispatch(JSON.stringify({apiVersion:API_VERSION,...body})))});
  const invoke=async(body:Record<string,unknown>)=>{const envelope=await request(body);assert.equal(envelope.ok,true);return unwrapResponse(JSON.parse(envelope.value));};
  try{
    const initial=await invoke({kind:'runtime',action:'status'}) as ManagementControlResult;
    assert.equal(initial.state,'stopped');
    let clicked:string|null=null;
    const tree=RuntimePanel({snapshot:initial,onControl:action=>{clicked=action;},onRefresh:()=>{}});
    (button(tree,'start').props['onClick'] as()=>void)();
    assert.equal(clicked,'start');
    const started=await invoke(controlRequest(clicked as 'start')) as ManagementControlResult;
    assert.equal(started.accepted,true);assert.equal(started.operationId!==null,true);
    await new Promise(done=>setTimeout(done,20));
    const running=await invoke({kind:'runtime',action:'status'}) as ManagementControlResult;
    assert.equal(running.state,'running');assert.equal(spawns,1);
    const runningTree=RuntimePanel({snapshot:running,onControl:()=>{},onRefresh:()=>{}});
    assert.equal(button(runningTree,'start').props['disabled'],true);
    assert.equal(button(runningTree,'stop').props['disabled'],false);
    const repeated=await invoke(controlRequest('start')) as ManagementControlResult;
    assert.equal(repeated.state,'running');assert.equal(spawns,1,'a repeated start must not create another process');
    const stopped=await invoke(controlRequest('stop')) as ManagementControlResult;
    assert.equal(stopped.state,'stopped');assert.equal(stopped.pid,null);
  }finally{await runtime.dispose();rmSync(root,{recursive:true,force:true});}
});
