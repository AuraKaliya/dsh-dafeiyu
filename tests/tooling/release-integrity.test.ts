import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,rmdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {testTempDir} from '../test-temp.ts';
import {saveJson} from '../../scripts/acceptance/io.mjs';
import {fileInventory,inventoryHash,inspectReleaseIntegrity,inspectInstalledDependencies} from '../../scripts/release-integrity.mjs';

function fixture(){
  const root=mkdtempSync(join(testTempDir(),'release-integrity-'));
  const pkg={name:'dsh-dafeiyu',version:'1.0.0',dependencies:{alpha:'1.0.0',beta:'1.0.0'}};
  saveJson(join(root,'package.json'),pkg);
  writeFileSync(join(root,'client.js'),'export const version="1.0.0";');
  for(const name of ['alpha','beta']){
    const module=join(root,'node_modules',name);mkdirSync(module,{recursive:true});
    saveJson(join(module,'package.json'),{name,version:'1.0.0',main:'index.js'});
    writeFileSync(join(module,'index.js'),'module.exports = {};');
  }
  const lock={name:pkg.name,version:pkg.version,lockfileVersion:3,packages:{'':{name:pkg.name,version:pkg.version,dependencies:{beta:'1.0.0',alpha:'1.0.0'}},'node_modules/alpha':{version:'1.0.0'},'node_modules/beta':{version:'1.0.0'}}};
  saveJson(join(root,'package-lock.json'),lock);
  const contentHash=inventoryHash(fileInventory(root,{payload:true}));
  saveJson(join(root,'release.json'),{version:pkg.version,contentHash});
  return {root,pkg,lock,contentHash};
}

test('payload and independently installed dependencies have separate content identities',()=>{
  const f=fixture();try{
    assert.equal(inspectReleaseIntegrity(f.root).contentHash,f.contentHash);
    const before=inspectInstalledDependencies(f.root);
    assert.deepEqual(before.dependencies.map(row=>row.name),['alpha','beta']);
    writeFileSync(join(f.root,'node_modules/alpha/index.js'),'module.exports = {changed:true};');
    assert.equal(inspectReleaseIntegrity(f.root).contentHash,f.contentHash);
    assert.notEqual(inspectInstalledDependencies(f.root).contentHash,before.contentHash);
    saveJson(join(f.root,'package-lock.json'),{...f.lock,packages:{...f.lock.packages,'node_modules/alpha':{version:'2.0.0'}}});
    assert.throws(()=>inspectInstalledDependencies(f.root),/RELEASE_DEPENDENCY_LOCK_MISMATCH/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('changed, additional or missing payload files fail even when package version is unchanged',()=>{
  for(const change of ['modify','add','delete']){
    const f=fixture();try{
      if(change==='modify')writeFileSync(join(f.root,'client.js'),'export const stale=true;');
      if(change==='add')writeFileSync(join(f.root,'unexpected.js'),'export {};');
      if(change==='delete')unlinkSync(join(f.root,'client.js'));
      assert.throws(()=>inspectReleaseIntegrity(f.root),/RELEASE_CONTENT_MISMATCH/,change);
    }finally{rmSync(f.root,{recursive:true,force:true});}
  }
});

test('dependency declarations, lock and installed versions must agree without borrowing a parent module',()=>{
  const f=fixture();try{
    saveJson(join(f.root,'package-lock.json'),{...f.lock,version:'2.0.0'});
    assert.throws(()=>inspectInstalledDependencies(f.root),/RELEASE_LOCK_MISMATCH/);
    saveJson(join(f.root,'package-lock.json'),f.lock);
    saveJson(join(f.root,'node_modules/alpha/package.json'),{name:'alpha',version:'2.0.0',main:'index.js'});
    assert.throws(()=>inspectInstalledDependencies(f.root),/RELEASE_DEPENDENCY_LOCK_MISMATCH/);
    // Even a matching lock/installation cannot silently loosen the frozen declaration.
    saveJson(join(f.root,'package.json'),{...f.pkg,dependencies:{alpha:'^2.0.0',beta:'1.0.0'}});
    saveJson(join(f.root,'package-lock.json'),{...f.lock,packages:{...f.lock.packages,'':{dependencies:{alpha:'^2.0.0',beta:'1.0.0'}},'node_modules/alpha':{version:'2.0.0'}}});
    assert.throws(()=>inspectInstalledDependencies(f.root),/RELEASE_DEPENDENCY_LOCK_MISMATCH/);
    saveJson(join(f.root,'package.json'),{...f.pkg,dependencies:{zod:'0.0.0'}});
    saveJson(join(f.root,'package-lock.json'),{...f.lock,packages:{'':{dependencies:{zod:'0.0.0'}}}});
    assert.throws(()=>inspectInstalledDependencies(f.root),/RELEASE_DEPENDENCY_OUTSIDE_PACKAGE/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('directory links cannot masquerade as installed release dependencies',()=>{
  const f=fixture(),external=mkdtempSync(join(testTempDir(),'external-module-')),link=join(f.root,'node_modules/borrowed');
  try{
    symlinkSync(external,link,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>inspectInstalledDependencies(f.root),/RELEASE_LINK_REFUSED/);
  }finally{
    if(process.platform==='win32')rmdirSync(link);else unlinkSync(link);
    rmSync(f.root,{recursive:true,force:true});rmSync(external,{recursive:true,force:true});
  }
});
