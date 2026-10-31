import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareInstallation} from '../packages/plugin/lib/installation.js';
import {claim,resource,owners} from '@dafeiyu/host';
import {Worker} from 'node:worker_threads';
import {testTempDir} from './test-temp.js';

test('releasing an installation lease waits for a concurrent coordination transaction',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bootstrap-lease-')),file=join(root,'coordination.sqlite');
  const lease=claim([resource(root,'directory')],{agentId:'fixture',profileId:'fixture'},file);
  const worker=new Worker("const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData);db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');setTimeout(()=>{db.exec('COMMIT');db.close();parentPort.close();},200);",{eval:true,workerData:file});
  try{await new Promise<void>((resolve,reject)=>{worker.once('message',()=>resolve());worker.once('error',reject);});lease.release();assert.deepEqual(owners(file),[]);}
  finally{await worker.terminate();lease.release();}
});

test('explicit initialization adds optional stores without replacing identity or existing databases',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bootstrap-')),file=join(root,'settings.json');
  const settings={schemaVersion:1,instanceName:'bootstrap',dataDir:join(root,'data'),model:{model:'fixture',credentialStore:join(root,'credentials.yaml')},
    qq:{botId:'10000001',ownerId:'10000002',tokenFile:join(root,'token.txt'),httpURL:'http://127.0.0.1:13000',wsURL:'ws://127.0.0.1:13001'},activity:{enabled:false}};
  await writeFile(settings.qq.tokenFile,'fixture-token-000000000000000000000000');await writeFile(file,JSON.stringify(settings));
  const first=prepareInstallation(file,{scripted:true,initializeModules:true});assert.equal(first.inspection.ready,true);
  const identity=await readFile(join(settings.dataDir,'installation.json'));
  const core=join(settings.dataDir,'core'),runtime=join(core,'runtime.sqlite');
  const digest=async()=>createHash('sha256').update(await readFile(runtime)).digest('hex'),before=await digest();
  await writeFile(file,JSON.stringify({...settings,activity:{enabled:true},bilibili:{capabilities:true},media:{ffmpeg:process.execPath,ffprobe:process.execPath}}));
  const pending=prepareInstallation(file,{scripted:true});assert.equal(pending.inspection.ready,false);
  assert.equal(existsSync(join(core,'bilibili.sqlite')),false,'ordinary startup must not provision an enabled module implicitly');
  const lease=claim(pending.prepared.resources,{agentId:first.meta.agentId,profileId:first.meta.profileId});
  try{assert.throws(()=>prepareInstallation(file,{scripted:true,initializeModules:true}),/HOST_STORE_OWNED/);}finally{lease.release();}
  const added=prepareInstallation(file,{scripted:true,initializeModules:true});assert.equal(added.inspection.ready,true);
  for(const name of ['activity','media','bilibili'])assert.ok(existsSync(join(core,name+'.sqlite')));
  assert.deepEqual(await readFile(join(settings.dataDir,'installation.json')),identity);assert.equal(await digest(),before);
  assert.equal(prepareInstallation(file,{scripted:true,initializeModules:true}).inspection.ready,true);
  await unlink(join(core,'media.sqlite'));
  assert.throws(()=>prepareInstallation(file,{scripted:true,initializeModules:true}),/HOST_REQUIRED_STORAGE_MISSING/);
  assert.equal(existsSync(join(core,'media.sqlite')),false,'a lost required store is never replaced with empty data');
});
