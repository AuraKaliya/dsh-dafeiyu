import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,unlinkSync,rmdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {BILI_APPLICATION_ID} from '@dafeiyu/bilibili';
import {inspectLocalDeploy} from '../../scripts/verify-local-deploy.mjs';

const marker='SESSDATA-path-must-not-be-echoed-1234567890';
function fixture():DeployFixture{
  const root=mkdtempSync(join(process.env.DAFEIYU_TEST_RUN??tmpdir(),'deploy-check-')),profile=join(root,'profile'),target=join(root,'package'),data=join(root,'data'),backup=join(root,'backup');
  mkdirSync(join(profile,'node_modules'),{recursive:true});mkdirSync(join(target,'bin'),{recursive:true});mkdirSync(join(target,'runtime/plugin/lib'),{recursive:true});
  mkdirSync(join(data,'core'),{recursive:true});mkdirSync(backup,{recursive:true});
  writeFileSync(join(target,'package.json'),JSON.stringify({name:'dsh-dafeiyu',version:'0.26.0',type:'module',main:'./runtime/plugin/lib/index.js'}));
  writeFileSync(join(target,'release.json'),JSON.stringify({schemaVersion:1,version:'0.26.0',revision:'c'.repeat(40),stores:{bilibili:6,runtime:2}}));
  writeFileSync(join(target,'client.js'),'// bundle\nwindow.__ModuleLoader__.load({id:"dsh-dafeiyu"});const x="df-runtime bilibili-status";\n');
  writeFileSync(join(target,'bin/dafeiyu.mjs'),'export {};\n');
  writeFileSync(join(target,'runtime/plugin/lib/index.js'),'export const name="dsh-dafeiyu";\n');
  const settings=join(root,'settings.json');
  writeFileSync(settings,JSON.stringify({schemaVersion:1,dataDir:'./data',model:{model:'fixture',credentialStore:'./credentials.json'},qq:{tokenFile:'./token.txt'},bilibili:{session:{file:marker,expectedUid:'42'}}}));
  writeFileSync(join(root,'token.txt'),'x'.repeat(40));
  writeFileSync(join(target,'cordis.patch.yml'),`- insert:\n    - id: dsh-dafeiyu\n      config:\n        settingsFile: '${settings.replaceAll('\\','/')}'\n        startOnLoad: true\n`);
  writeFileSync(join(data,'core','host-status.json'),JSON.stringify({at:new Date().toISOString(),phase:'ready',accepting:true,pid:process.pid,schemas:{bilibili:6}}));
  const bili=new DatabaseSync(join(data,'core','bilibili.sqlite'));try{bili.exec(`PRAGMA application_id=${BILI_APPLICATION_ID};PRAGMA user_version=6;`);}finally{bili.close();}
  const runtime=new DatabaseSync(join(data,'core','runtime.sqlite'));try{runtime.exec('PRAGMA user_version=2;');}finally{runtime.close();}
  const dependency='link:'+target.replaceAll('\\','/');
  writeFileSync(join(profile,'package.json'),JSON.stringify({name:'fixture',dependencies:{'dsh-dafeiyu':dependency}}));
  symlinkSync(target,join(profile,'node_modules','dsh-dafeiyu'),process.platform==='win32'?'junction':'dir');
  return {root,profile,target,data,backup,settings};
}
interface DeployFixture {root:string;profile:string;target:string;data:string;backup:string;settings:string}
const options=(f:DeployFixture)=>({profile:f.profile,expectVersion:'0.26.0',expectBiliStore:6,expectRuntimeStore:2,backup:f.backup});
const removeLink=(path:string)=>{try{if(process.platform==='win32')rmdirSync(path);else unlinkSync(path);}catch{/* already gone */}};
const clean=(f:DeployFixture)=>{removeLink(join(f.profile,'node_modules','dsh-dafeiyu'));rmSync(f.root,{recursive:true,force:true});};

test('the preflight verifies the profile link, release, client bundle, settings and storage versions without echoing secret paths',()=>{
  const f=fixture();try{
    const result=inspectLocalDeploy(options(f));
    assert.deepEqual(result.faults,[]);assert.equal(result.ready,true);
    assert.equal(result.package?.version,'0.26.0');assert.equal(result.package?.revision,'c'.repeat(40));
    assert.deepEqual(result.checks.stores,{bilibili:6,runtime:2});
    assert.equal(result.checks.instance?.pidAlive,true);assert.equal(result.checks.instance?.phase,'ready');
    assert.equal(result.checks.configured?.bilibiliSession,true);
    const serialized=JSON.stringify(result);
    assert.equal(serialized.includes(marker),false,'the configured credential path is never echoed');
    assert.equal(serialized.includes('token.txt'),false);

    // Version drift and a stale client bundle are reported, not silently accepted.
    const db=new DatabaseSync(join(f.data,'core','bilibili.sqlite'));try{db.exec('PRAGMA user_version=5;');}finally{db.close();}
    const mismatch=inspectLocalDeploy(options(f));
    assert.ok(mismatch.faults.some(fault=>fault.code==='BILIBILI_STORE_MISMATCH'));
    writeFileSync(join(f.target,'client.js'),'// stale bundle\nconst x="df-runtime";\n');
    const stale=inspectLocalDeploy(options(f));
    assert.ok(stale.faults.some(fault=>fault.code==='CLIENT_BUNDLE_STALE'));
  }finally{clean(f);}
});

test('a link that resolves somewhere else or a missing backup is refused before any switch',()=>{
  const f=fixture();try{
    removeLink(join(f.profile,'node_modules','dsh-dafeiyu'));
    const other=join(f.root,'other');mkdirSync(other);
    symlinkSync(other,join(f.profile,'node_modules','dsh-dafeiyu'),process.platform==='win32'?'junction':'dir');    const mismatch=inspectLocalDeploy(options(f));
    assert.ok(mismatch.faults.some(fault=>fault.code==='PROFILE_LINK_TARGET_MISMATCH'));
    rmSync(f.backup,{recursive:true,force:true});
    const missing=inspectLocalDeploy(options(f));
    assert.ok(missing.faults.some(fault=>fault.code==='BACKUP_MISSING'));
  }finally{clean(f);}
});
