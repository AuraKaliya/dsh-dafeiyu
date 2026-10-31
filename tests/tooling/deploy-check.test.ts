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
  writeFileSync(join(root,'credentials.json'),'{"version":1,"refs":{}}');
  writeFileSync(join(root,marker),'{"uid":"42","SESSDATA":"fixture"}');
  writeFileSync(join(target,'cordis.patch.yml'),`- insert:\n    - id: dsh-dafeiyu\n      config:\n        settingsFile: '${settings.replaceAll('\\','/')}'\n        startOnLoad: true\n`);
  writeFileSync(join(data,'core','host-status.json'),JSON.stringify({at:new Date().toISOString(),phase:'ready',accepting:true,pid:process.pid,schemas:{bilibili:6}}));
  const bili=new DatabaseSync(join(data,'core','bilibili.sqlite'));try{bili.exec(`PRAGMA application_id=${BILI_APPLICATION_ID};PRAGMA user_version=6;`);}finally{bili.close();}
  const runtime=new DatabaseSync(join(data,'core','runtime.sqlite'));try{runtime.exec('PRAGMA user_version=2;');}finally{runtime.close();}
  const dependency='link:'+target.replaceAll('\\','/');
  writeFileSync(join(profile,'package.json'),JSON.stringify({name:'fixture',dependencies:{'dsh-dafeiyu':dependency}}));
  writeFileSync(join(profile,'pnpm-lock.yaml'),`lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      dsh-dafeiyu:\n        specifier: '${dependency}'\n        version: '${dependency}'\n`);
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

test('static readiness cannot claim online status from a stale snapshot or a different package',()=>{
  const f=fixture();try{
    assert.equal(inspectLocalDeploy({...options(f),requireOnline:true}).ready,false);
    const status=join(f.data,'core/host-status.json'),current={at:new Date().toISOString(),pid:process.pid,phase:'ready',accepting:true,plugins:[{id:'memory',version:'0.26.0'}]};
    writeFileSync(status,JSON.stringify(current));assert.equal(inspectLocalDeploy({...options(f),requireOnline:true}).online,true);
    writeFileSync(status,JSON.stringify({...current,at:'2020-01-01T00:00:00.000Z'}));assert.equal(inspectLocalDeploy({...options(f),requireOnline:true}).ready,false);
    writeFileSync(status,JSON.stringify({...current,plugins:[{id:'memory',version:'0.25.1'}]}));assert.equal(inspectLocalDeploy({...options(f),requireOnline:true}).ready,false);
  }finally{clean(f);}
});

test('missing credentials, a BOM and a mismatched lock are explicit preflight failures',()=>{
  const f=fixture();try{
    unlinkSync(join(f.root,marker));assert.ok(inspectLocalDeploy(options(f)).faults.some(fault=>fault.code==='BILIBILI_CREDENTIAL_MISSING'));
    const json=JSON.stringify({dependencies:{'dsh-dafeiyu':'link:'+f.target.replaceAll('\\','/')}});
    writeFileSync(join(f.profile,'package.json'),'\ufeff'+json);writeFileSync(join(f.profile,'pnpm-lock.yaml'),'importers: {}');
    const codes=inspectLocalDeploy(options(f)).faults.map(fault=>fault.code);assert.ok(codes.includes('PROFILE_JSON_BOM'));assert.ok(codes.includes('PROFILE_LOCK_TARGET_MISMATCH'));
  }finally{clean(f);}
});

test('a new QQ-only installation does not require optional Bilibili storage',()=>{
  const f=fixture();try{
    writeFileSync(f.settings,JSON.stringify({dataDir:'./data',model:{model:'fixture',credentialStore:'./credentials.json'},qq:{tokenFile:'./token.txt'}}));
    unlinkSync(join(f.data,'core/bilibili.sqlite'));
    assert.equal(inspectLocalDeploy({profile:f.profile,expectVersion:'0.26.0',expectRuntimeStore:2}).ready,true);
  }finally{clean(f);}
});
