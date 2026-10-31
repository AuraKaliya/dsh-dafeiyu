import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {MEMORY_SCHEMA_VERSION} from '@dafeiyu/memory/store';
import {readHostStatus} from '../packages/host/lib/status.js';
import type {PreparedHostConfig} from '../packages/host/lib/configuration.js';
import {testTempDir} from './test-temp.js';

const root=()=>mkdtempSync(join(testTempDir(),'host-status-'));
const config=(directory:string,hash='a'.repeat(64))=>(({paths:{core:directory},hash,resources:[],config:{profileId:'dafeiyu-local',agent:{id:'agent-1'},diagnostics:{snapshotIntervalMs:10_000}}}) as unknown as PreparedHostConfig);
const snapshot=(options:{bilibiliStore?:number;at?:string;configHash?:string}={})=>({
  schemaVersion:1,profileId:'dafeiyu-local',agentId:'agent-1',instanceId:randomUUID(),pid:process.pid,at:options.at??new Date().toISOString(),
  configHash:options.configHash??'a'.repeat(64),foundationHash:'b'.repeat(64),phase:'degraded',mode:'daemon',accepting:true,error:null,
  plugins:[{id:'bilibili',required:true,state:'degraded',version:'0.26.0',code:'HOST_BILI_DIAGNOSTIC_REQUIRED'}],
  features:['bilibili.read.v1'],
  services:{
    memory:{context:{automaticRecall:true,recallStrategy:'lexical',recentState:true,sharedRecentState:false},lifecycle:'active',analysis:{state:'not-configured',active:false},
      retrieval:'not-configured',compaction:'configured',sourceTracking:'configured'},
    activity:null,
    media:{lifecycle:'active',modalities:{vision:true,asr:true,events:true,documents:true,tts:false},counts:{sources:0,assets:0,bytes:0,drafts:0,exports:0,jobs:{}},reconciliation:{settled:0,pending:0,conflicts:0}},
    bilibili:{lifecycle:'active',media:true,counts:{pages:82,requests:115,pending:0},backoffUntil:0,diagnosticRequired:true,
      diagnostic:{account:{engine:'unverified'},http:{identity:'anonymous',state:'diagnostic-required'},browser:{configured:true,state:'identity-check-required'},pause:{scope:'anonymous-http',kind:'risk',endpoint:'video',failures:2,held:true,waitUntil:null}}},
    taskDelivery:{total:3,pending:0,sent:2,partial:0,uncertain:0,blocked:1},
    qq:{state:'online',groupSync:'current',groupError:null,effectiveGroups:3,lastGroupSync:new Date().toISOString(),capabilities:true,tasks:{enabled:true,registered:true,deliverResults:true},delivery:{plans:15,pending:0,unknown:0}},
  },
  counts:{activeRuns:0,queuedRuns:0,queuedRoutes:0,pendingMessages:0,outbox:0},
  schemas:{journal:1,memory:MEMORY_SCHEMA_VERSION,runtime:2,activity:null,media:2,bilibili:options.bilibiliStore??5},
});
const write=(directory:string,value:unknown,bytes?:string)=>writeFileSync(join(directory,'host-status.json'),bytes??JSON.stringify(value));

test('the saved host snapshot stays readable across storage-version drift and channel diagnostics',()=>{
  const directory=root();
  try{
    write(directory,snapshot());
    const result=readHostStatus(config(directory),join(directory,'coordination.sqlite'));
    assert.equal(result.snapshot?.phase,'degraded');
    assert.equal(result.snapshot?.services.bilibili?.diagnosticRequired,true);
    assert.deepEqual(result.snapshot?.services.bilibili?.diagnostic,{account:{engine:'unverified'},http:{identity:'anonymous',state:'diagnostic-required'},browser:{configured:true,state:'identity-check-required'},pause:{scope:'anonymous-http',kind:'risk',endpoint:'video',failures:2,held:true,waitUntil:null}});
    assert.equal(result.snapshot?.schemas.bilibili,5);
    assert.ok(result.codes.includes('HOST_STATUS_NOT_OWNED'));
    assert.equal(result.fresh,true);
    assert.equal(result.online,false);

    write(directory,snapshot({bilibiliStore:6}));
    assert.equal(readHostStatus(config(directory),join(directory,'coordination.sqlite')).snapshot?.schemas.bilibili,6,'a newer storage version remains readable');

    const stale=readHostStatus(config(directory),join(directory,'coordination.sqlite'),Date.now()+60_000);
    assert.ok(stale.codes.includes('HOST_STATUS_STALE'));
    assert.equal(stale.fresh,false);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('an edited or unreadable snapshot is rejected instead of being reported as running',()=>{
  const directory=root();
  try{
    write(directory,snapshot(),'{"schemaVersion":1}');
    assert.throws(()=>readHostStatus(config(directory),join(directory,'coordination.sqlite')),/HOST_STATUS_INVALID/);
    write(directory,snapshot({bilibiliStore:999}));
    assert.throws(()=>readHostStatus(config(directory),join(directory,'coordination.sqlite')),/HOST_STATUS_INVALID/);
    const secret=snapshot() as Record<string,unknown>;secret.cookie='SESSDATA=must-not-be-accepted';
    write(directory,secret);
    assert.throws(()=>readHostStatus(config(directory),join(directory,'coordination.sqlite')),/HOST_STATUS_INVALID/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
