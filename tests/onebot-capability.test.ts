import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ChildProcess} from 'node:child_process';
import {OneBotCapability} from '../packages/plugin/lib/onebot-capability.js';
import type {InstallationSettings} from '../packages/plugin/lib/settings.js';

const qq=(tokenFile:string,overrides:Record<string,unknown>={})=>({
  botId:'1994142241',ownerId:'756013063',
  tokenFile,httpURL:'http://127.0.0.1:13000/',wsURL:'ws://127.0.0.1:13001/',
  ...overrides,
}) as unknown as InstallationSettings['qq'];

test('reuses an already-running OneBot without claiming ownership',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-onebot-ready-'));
  try{
    const token=join(root,'token');writeFileSync(token,'token-value');
    const capability=new OneBotCapability(qq(token),{fetch:async()=>new Response(JSON.stringify({status:'ok',data:{user_id:1994142241}}),{status:200})});
    await capability.ensureReady();
    assert.deepEqual(capability.status(),{id:'qq',state:'ready',owned:false,pid:null,code:null,message:null});
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('reports a waiting login instead of claiming an unmanaged OneBot started',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-onebot-wait-'));
  try{
    const token=join(root,'token');writeFileSync(token,'token-value');
    const capability=new OneBotCapability(qq(token),{fetch:async()=>{throw new Error('offline');}});
    await assert.rejects(capability.ensureReady(),/ONEBOT_NOT_RUNNING/);
    assert.equal(capability.status().state,'waiting-login');
    assert.equal(capability.status().owned,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('starts its own service and attaches the configured account',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-onebot-service-'));
  try{
    writeFileSync(join(root,'password.json'),JSON.stringify({webui:'secret'}));
    const token=join(root,'token');writeFileSync(token,'token-value');
    const child=new EventEmitter() as ChildProcess;
    Object.assign(child,{pid:1234,kill:()=>true});
    let loginCalls=0,attached=false;
    const capability=new OneBotCapability(qq(token,{service:{command:'D:/service/node.exe',args:['index.mjs'],webui:{url:'http://127.0.0.1:15099',passwordFile:join(root,'password.json')},startTimeoutMs:5000}}),{
      spawn:()=>child,
      sleep:async()=>{},
      fetch:async (input,init)=>{
        const url=String(input);
        if(url.endsWith('/api/login'))return new Response(JSON.stringify({success:true,token:'admin'}),{status:200});
        if(url.endsWith('/api/processes'))return new Response(JSON.stringify({list:[{pid:7,connected:false,account:{uin:'1994142241'}}]}),{status:200});
        if(url.endsWith('/api/processes/7/load')){attached=true;return new Response(JSON.stringify({success:true}),{status:200});}
        loginCalls++;
        return new Response(JSON.stringify(attached?{status:'ok',data:{user_id:1994142241}}:{status:'failed'}),{status:200});
      },
    });
    await capability.ensureReady();
    assert.equal(loginCalls,3,'one probe before start, one before attach and one after attach');
    assert.equal(attached,true);
    assert.equal(capability.status().state,'ready');
    assert.equal(capability.status().owned,true);
    assert.equal(capability.status().pid,1234);
  }finally{rmSync(root,{recursive:true,force:true});}
});
