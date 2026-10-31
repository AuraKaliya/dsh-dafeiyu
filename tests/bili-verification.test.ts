import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Context} from '@deepseek-ai/cordis';
import type {DafeiyuService} from '@dafeiyu/core';
import {BiliService,BILI_APPLICATION_ID,BILI_SCHEMA_VERSION,BiliStore} from '@dafeiyu/bilibili';
import {inspectBiliMigration,migrateBiliStorage} from '../packages/bilibili/lib/migration.js';
import {InstallationSettingsSchema} from '../packages/plugin/lib/settings.js';
import type {HttpResponse} from '../packages/bilibili/lib/http.js';
import {testTempDir} from './test-temp.js';

const identity={agentId:'fish',profileId:'test'},bvid='BV1xNpFedEwH',cookieMarker='SESSDATA-management-marker-9876543210';
const response=(body:string,status=200):HttpResponse=>{const bytes=Buffer.from(body);return {status,headers:{'content-type':'application/json','content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};};
const nav=(mid='42')=>JSON.stringify({code:0,data:{isLogin:true,mid,wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/'+'a'.repeat(32)+'.png',sub_url:'https://i0.hdslb.com/bfs/wbi/'+'b'.repeat(32)+'.png'}}});
const video=()=>JSON.stringify({code:0,data:{bvid,aid:'170001',title:'Fixture video',owner:{mid:999,name:'Up'},pages:[{cid:'9',page:1,part:'p1',duration:10}]}});
interface OperationView {state:string;kind:string;errorCode:string|null;result:{stage?:string;login?:{ok:boolean;uid:string|null};read?:{ok:boolean;title?:string|null;items?:number|null}|null}|null}
interface StatusView {account:{engine:string;verifiedUid:string|null};operations:OperationView[];active:{id:string}|null;operation?:OperationView}
const view=(value:unknown)=>value as StatusView;
const waitFor=async(predicate:()=>boolean,label:string)=>{const deadline=Date.now()+5000;while(Date.now()<deadline){if(predicate())return;await new Promise(done=>setTimeout(done,20));}throw new Error('TIMEOUT '+label);};
async function fixture(){
  const root=await mkdtemp(join(testTempDir(),'bili-verify-')),sessionFile=join(root,'session.json');
  await writeFile(sessionFile,JSON.stringify({uid:'42',SESSDATA:cookieMarker}));
  const context=new Context(),extensions=new Map<string,{id:string}>();
  const core={registerExtension:(extension:{id:string})=>{extensions.set(extension.id,extension);return {dispose(){extensions.delete(extension.id);}};},
    capabilityManifest:()=>({features:[]}),taskContextScope:()=>({kind:'context',scopeKey:'fixture'}),
    journal:{appendExecutionOnce(){},appendOnce(){}}};
  context.provide('dafeiyu',core as unknown as DafeiyuService);
  const calls:string[]=[],controls={nav:'ok' as 'ok'|'hang'|'hold'};
  let releaseNav:()=>void=()=>{};
  const navHold=new Promise<void>(resolve=>{releaseNav=resolve;});
  const transport=async(url:URL,_headers:Readonly<Record<string,string>>,signal:AbortSignal)=>{
    calls.push(url.pathname);
    if(url.pathname.endsWith('/nav')){
      if(controls.nav==='hang')await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
      if(controls.nav==='hold')await new Promise<void>((resolve,reject)=>{void navHold.then(resolve);signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
      return response(nav());
    }
    return response(video());
  };
  const service=new BiliService(context,{agentId:'fish',profileId:'fixture',dataDir:join(root,'bili'),createStore:true,settings:{session:{file:sessionFile,expectedUid:'42'},minIntervalMs:100}},transport);
  service.recover();service.activate();
  return {root,sessionFile,service,controls,calls,releaseNav:()=>releaseNav(),close:async()=>{await service.close();await context.fiber.dispose();}};
}
const count=(calls:string[],path:string)=>calls.filter(call=>call===path).length;

test('management verification performs one login check and one designated read with separate results',async()=>{
  const f=await fixture();try{
    const status=view(f.service.management('verify.status',{}));
    assert.equal(status.account.engine,'unverified');assert.equal(status.operations.length,0);
    const started=f.service.management('verify.start',{}) as {accepted:boolean;operationId:string};
    assert.equal(started.accepted,true);assert.equal(typeof started.operationId,'string');
    await waitFor(()=>view(f.service.management('verify.status',{id:started.operationId})).operation?.state!=='pending','login verification');
    const login=view(f.service.management('verify.status',{id:started.operationId}));
    assert.equal(login.operation?.state,'completed');assert.equal(login.operation?.kind,'login');assert.equal(login.operation?.result?.stage,'login');
    assert.equal(login.account.engine,'verified');assert.equal(login.account.verifiedUid,'42');
    assert.equal(count(f.calls,'/x/web-interface/nav'),1);
    const read=f.service.management('verify.read',{endpoint:'video',bvid}) as {accepted:boolean;operationId:string};
    assert.equal(read.accepted,true);
    await waitFor(()=>view(f.service.management('verify.status',{id:read.operationId})).operation?.state!=='pending','read verification');
    const done=view(f.service.management('verify.status',{id:read.operationId}));
    assert.equal(done.operation?.state,'completed');assert.equal(done.operation?.kind,'read');assert.equal(done.operation?.result?.read?.ok,true);
    assert.equal(done.operation?.result?.read?.title,'Fixture video');
    assert.equal(done.account.engine,'verified','login validity stays separate and visible');
    assert.equal(count(f.calls,'/x/web-interface/nav'),2,'one login verification per flow');
    assert.equal(count(f.calls,'/x/web-interface/view'),1,'exactly one designated business read');
    const meta=f.service.store.authMeta;assert.equal(meta?.lastVerifiedUid,'42');assert.ok(meta?.lastVerifiedAt);
    const serialized=JSON.stringify({status:f.service.management('verify.status',{}),operation:f.service.management('verify.status',{id:read.operationId})});
    assert.equal(serialized.includes(cookieMarker),false);assert.equal(serialized.includes(f.sessionFile),false);
  }finally{await f.close();}
});

test('repeated verification clicks reuse the in-flight operation and cancel marks it interrupted',async()=>{
  const f=await fixture();try{
    f.controls.nav='hang';
    const first=f.service.management('verify.start',{}) as {operationId:string},second=f.service.management('verify.start',{}) as {reused?:boolean;operationId:string};
    assert.equal(second.reused,true);assert.equal(second.operationId,first.operationId);
    await new Promise(done=>setTimeout(done,30));
    assert.equal(count(f.calls,'/x/web-interface/nav'),1,'duplicate clicks never append a probe request');
    const cancelled=view(f.service.management('verify.cancel',{}));
    assert.equal(cancelled.active,null);
    const record=f.service.store.verification(first.operationId);
    assert.equal(record?.state,'interrupted');assert.equal(record?.errorCode,'BILI_VERIFICATION_CANCELLED');
  }finally{await f.close();}
});

test('a credential change during verification interrupts the operation instead of committing a stale result',async()=>{
  const f=await fixture();try{
    f.controls.nav='hold';
    const started=f.service.management('verify.start',{}) as {operationId:string};
    await new Promise(done=>setTimeout(done,30));
    await writeFile(f.sessionFile,JSON.stringify({uid:'42',SESSDATA:cookieMarker+'-rotated'}));
    f.releaseNav();
    await waitFor(()=>view(f.service.management('verify.status',{id:started.operationId})).operation?.state!=='pending','credential change');
    const operation=view(f.service.management('verify.status',{id:started.operationId})).operation;
    assert.equal(operation?.state,'interrupted');assert.equal(operation?.errorCode,'BILI_SESSION_CHANGED');
    assert.equal(f.service.store.authMeta?.lastVerifiedUid??null,null,'a stale success is never recorded as verified');
    assert.notEqual(f.service.client.accountStatus().engine,'verified');
  }finally{await f.close();}
});

test('a local credential error fails before any network request and a restart interrupts pending verification',async()=>{
  const f=await fixture();try{
    await rm(f.sessionFile);
    const started=f.service.management('verify.start',{}) as {operationId:string};
    await waitFor(()=>view(f.service.management('verify.status',{id:started.operationId})).operation?.state!=='pending','local failure');
    const operation=view(f.service.management('verify.status',{id:started.operationId})).operation;
    assert.equal(operation?.state,'failed');assert.equal(operation?.errorCode,'BILI_SESSION_INVALID');
    assert.equal(f.calls.length,0,'a local check failure sends no request');
  }finally{await f.close();}
  const g=await fixture();try{
    const now=new Date().toISOString();
    g.service.store.beginVerification({id:randomUUID(),at:now,updatedAt:now,state:'pending',kind:'login',endpoint:'nav',uid:'42',credentialGeneration:0,instanceGeneration:0,target:null,result:null,errorCode:null});
    assert.equal(g.service.store.verifications(10).some(record=>record.state==='pending'),true);
    g.service.recover();
    assert.equal(g.service.store.verifications(10).every(record=>record.state!=='pending'),true);
    assert.equal(g.service.store.verifications(10).some(record=>record.errorCode==='BILI_VERIFICATION_INTERRUPTED'),true);
  }finally{await g.close();}
});

test('session, browser and owner-message accounts must agree before the capability is enabled',()=>{
  const config={schemaVersion:1,dataDir:'./data',instanceName:'dafeiyu',dshTools:true,model:{model:'fixture',credentialStore:'./credentials.json'},
    qq:{botId:'1994142241',ownerId:'756013063',tokenFile:'./token.txt',httpURL:'http://127.0.0.1:13000/',wsURL:'ws://127.0.0.1:13001/'},activity:{enabled:false},
    bilibili:{capabilities:false,session:{file:'./session.json',expectedUid:'42'},browser:{expectedUid:'43'},channel:{accountUid:'42',ownerUid:'7',sessionFile:'./channel.json'}}};
  const mismatch=InstallationSettingsSchema.safeParse(config);
  assert.equal(mismatch.success,false);
  assert.equal(mismatch.success?false:mismatch.error.issues.some(issue=>issue.path.join('.')==='bilibili.browser.expectedUid'),true);
  const same=InstallationSettingsSchema.safeParse({...config,bilibili:{...config.bilibili,browser:{expectedUid:'42'}}});
  assert.equal(same.success,true);
});

function v5Fixture(evidence:boolean){
  const root=mkdtempSync(join(testTempDir(),'bili-v5-')),file=join(root,'bilibili.sqlite');
  new BiliStore(file,identity,true).close();
  const db=new DatabaseSync(file);
  try{
    db.prepare('INSERT INTO bili_pages VALUES(?,?,?,?,NULL)').run('page-1','owner-1',JSON.stringify({kind:'video'}),'hash-1');
    db.prepare('INSERT INTO bili_reading VALUES(?,?,?,?,?)').run('owner-1','BV1xNpFedEwH',3,'{}',12345);
    db.exec('DROP TABLE bili_auth_meta;DROP TABLE bili_verifications;');
    if(evidence)db.prepare('INSERT INTO bili_http_attempts VALUES(?,?,?)').run(randomUUID(),Date.now()-5000,JSON.stringify({id:randomUUID(),at:Date.now()-5000,sentAt:Date.now()-5000,endedAt:Date.now()-5000,transport:'http',auth:'anonymous',origin:'maintenance',taskId:null,runId:null,operationId:null,networkSent:true,httpStatus:200,platformCode:-352,endpoint:'video',contentType:'application/json',retryAfter:null,retryAt:null,waitSource:null,outcome:'failed',errorCode:'BILI_BACKOFF',kind:'risk'}));
    db.prepare('UPDATE bili_http_control SET body=? WHERE id=1').run(JSON.stringify({failures:2,kind:'risk',endpoint:'video',held:true,probeId:null,probeUntil:0}));
    db.prepare('UPDATE bili_clock SET blocked_until=? WHERE id=1').run(Date.now()+1_234_567);
    db.exec('PRAGMA user_version=5;');
  }finally{db.close();}
  return {root,file,backup:join(root,'backup.sqlite')};
}

test('v5 to v6 converts the single pause row with evidence-based scope and preserves existing tables',async()=>{
  for(const evidence of [true,false]){
    const f=v5Fixture(evidence);
    try{
      assert.deepEqual(inspectBiliMigration(f.file,identity),{exists:true,version:5,applicationId:BILI_APPLICATION_ID,integrity:true,identityMatches:true,state:'upgradable'});
      assert.throws(()=>new BiliStore(f.file,identity),/BILI_MIGRATION_REQUIRED/,'the store never migrates implicitly');
      const result=migrateBiliStorage(f.file,identity,{backup:f.backup});
      assert.equal(result.migrated,true);assert.equal(result.version,BILI_SCHEMA_VERSION);assert.equal(result.backup,f.backup);
      const db=new DatabaseSync(f.file,{readOnly:true});
      try{
        assert.equal(db.prepare('SELECT count(*) AS n FROM bili_pages').get()!.n,1);
        assert.equal(db.prepare('SELECT count(*) AS n FROM bili_reading').get()!.n,1);
        assert.equal(db.prepare('SELECT count(*) AS n FROM bili_auth_meta').get()!.n,0);
        assert.equal(db.prepare('SELECT count(*) AS n FROM bili_verifications').get()!.n,0);
        const control=JSON.parse(String(db.prepare('SELECT body FROM bili_http_control WHERE id=1').get()!.body));
        assert.equal(control.version,2);assert.equal(control.probe,null);assert.equal(control.permit,null);
        assert.equal(control.pauses.length,1);
        assert.equal(control.pauses[0].endpoint,'video');assert.equal(control.pauses[0].kind,'risk');assert.equal(control.pauses[0].failures,2);assert.equal(control.pauses[0].held,true);
        assert.equal(control.pauses[0].scope,evidence?'anonymous-http':'shared','evidence decides the scope; unknown pause is shared');
        assert.equal(control.pauses[0].until,Number(db.prepare('SELECT blocked_until FROM bili_clock WHERE id=1').get()!.blocked_until));
        assert.equal(db.prepare('SELECT count(*) AS n FROM bili_http_attempts').get()!.n,evidence?1:0);
      }finally{db.close();}
      assert.equal(inspectBiliMigration(f.file,identity).state,'current');
      assert.equal(migrateBiliStorage(f.file,identity,{backup:f.backup}).migrated,false,'a repeated migration has no side effects');
    }finally{rmSync(f.root,{recursive:true,force:true});}
  }
});

test('an unknown storage version is reported unsupported and never migrated',async()=>{
  const root=mkdtempSync(join(testTempDir(),'bili-v99-')),file=join(root,'bilibili.sqlite');
  try{
    new BiliStore(file,identity,true).close();
    const db=new DatabaseSync(file);try{db.exec('PRAGMA user_version=99;');}finally{db.close();}
    assert.equal(inspectBiliMigration(file,identity).state,'unsupported');
    assert.throws(()=>migrateBiliStorage(file,identity,{backup:join(root,'backup.sqlite')}),/BILI_MIGRATION_UNSUPPORTED/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
