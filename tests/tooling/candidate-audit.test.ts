import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTempDir} from '../test-temp.ts';
import {saveJson} from '../../scripts/acceptance/io.mjs';
import {catalog} from '../../scripts/acceptance/catalog.ts';
import {auditLocalCandidate} from '../../scripts/acceptance/candidate-audit.ts';
import {verifyCandidate} from '../../scripts/acceptance/seal-candidate.ts';
import {fileHash,fileInventory,inventoryHash,inspectInstalledDependencies} from '../../scripts/release-integrity.mjs';

const identity={sourceHash:'a'.repeat(64),driverHash:'b'.repeat(64),runtimeHash:'c'.repeat(64)};
const binding={...identity,version:'1.0.0',contentHash:'d'.repeat(64),unitFiles:['tests/unit.test.ts','tests/tooling/tool.test.ts'],smokeFiles:['tests/smoke/host.test.ts']};
function fixture(){
  const regression={suite:'unit',files:[...binding.unitFiles],identity:{...identity},identityAfter:{...identity},reason:null,realModel:false,realPlatform:false,serverAccess:false,cleanup:{blocked:[] as unknown[]},stages:[{code:0}],summary:{success:true,counts:{tests:3,failed:0,skipped:0,cancelled:0,todo:0}}};
  return {
    regression,smoke:{...structuredClone(regression),suite:'smoke',files:[...binding.smokeFiles]},
    business:{manifest:{...identity,version:binding.version},completion:{...identity},passed:true,scenarios:catalog.map(row=>({id:row.id,state:'passed'}))},
    performance:{manifest:{...identity,version:binding.version,runId:'performance',mode:'offline-sdk',concurrency:1,paidCalls:false,realPlatforms:false},runId:'performance',runtimeHash:identity.runtimeHash,passed:true,checks:{process:true,sourceUnchanged:true,driverUnchanged:true,sameWork:true,responsive:true,cancelled:true,recovered:true},baseline:{sent:'完整范围说明'},heavy:{reads:64,requests:67,taskRuns:1,capacity:1000000,sent:'完整范围说明',maxLoopDelayMs:500},cancel:{reads:48,sent:null,cancelResponseMs:200,cancelSettledMs:300},recovery:{reads:0,requests:0,storedRequests:67,taskRuns:1,sent:'完整范围说明'}},
    fresh:{passed:true,version:binding.version,releaseHash:binding.contentHash,identityPreserved:true,entryImported:true,initialized:true,starts:[1,2,3].map(pid=>({pid,observedPid:pid,instanceId:'instance-'+pid,phase:'ready',online:true,loadedPlugins:['timeline','memory','channel-qq'].map(id=>({id,version:binding.version,state:'ready'}))})),stops:[1,2,3].map(pid=>({pid,exitCode:0,online:false})),duplicateStarts:[1,2,3].map(()=>({pidPreserved:true,instancePreserved:true,code:'HOST_ALREADY_OWNED'})),counts:{modelGenerations:0,platformSends:0}},
    upgrade:{passed:true,to:{version:binding.version,contentHash:binding.contentHash},identityPreserved:true,wrongIdentityRefused:true,activeOwnerRefused:true,pendingResultPreserved:true,unknownOperationPreserved:true,unknownSendPreserved:true,planVersionPreserved:true,watermarkPreserved:true,matchingRollback:true,postUpgradeCopyPreserved:true,modelsCalled:0,platformSends:0,realData:false},
    calibration:{manifest:{...identity,modelCalled:false,semanticReliabilityProven:false},readiness:{counts:{notExecuted:24},semanticReliabilityProven:false},observations:{observations:[] as unknown[]}}
  };
}

test('complete local evidence stays a local candidate with every real-world gate pending',()=>{
  const result=auditLocalCandidate(binding,fixture());
  assert.equal(result.localReady,true);assert.equal(result.releaseAccepted,false);
  assert.equal(result.paidTestsStarted,false);assert.equal(result.deployed,false);
  assert.equal(result.pending.length,4);
});

test('selected tests, partial coverage, skipped tests, code drift and incomplete business scenarios are refused',()=>{
  const changes:((f:ReturnType<typeof fixture>)=>void)[]=[
    f=>{f.regression.suite='selected';},f=>{f.regression.files.pop();},f=>{f.regression.summary.counts.skipped=1;},f=>{f.regression.summary.counts.todo=1;},f=>{f.regression.cleanup.blocked.push({code:'TEST_CLEANUP_FAILED'});},
    f=>{f.regression.identityAfter.sourceHash='f'.repeat(64);},f=>{f.smoke.identity.runtimeHash='f'.repeat(64);},
    f=>{f.business.completion.driverHash='f'.repeat(64);},f=>{f.business.scenarios.pop();}
  ];
  for(const change of changes){const f=fixture();change(f);assert.equal(auditLocalCandidate(binding,f).localReady,false);}
});

test('performance success flags cannot mask reduced work, slower cancellation or a changed recovery result',()=>{
  const changes:((f:ReturnType<typeof fixture>)=>void)[]=[
    f=>{f.performance.heavy.reads=63;},f=>{f.performance.heavy.capacity=128000;},f=>{f.performance.heavy.maxLoopDelayMs=1000;},
    f=>{f.performance.cancel.cancelResponseMs=1000;},f=>{f.performance.cancel.cancelSettledMs=1500;},f=>{f.performance.recovery.requests=1;},
    f=>{f.performance.recovery.sent='遗漏正文';},f=>{f.performance.runtimeHash='f'.repeat(64);},f=>{f.performance.runId='stale';},
    f=>{f.performance.manifest.concurrency=4;},f=>{f.performance.checks.process=false;}
  ];
  for(const change of changes){const f=fixture();change(f);assert.equal(auditLocalCandidate(binding,f).localReady,false);}
});

test('stale readiness, missing stops, lost receipts and fabricated semantic observations cannot pass',()=>{
  const changes:((f:ReturnType<typeof fixture>)=>void)[]=[
    f=>{f.fresh.releaseHash='e'.repeat(64);},f=>{f.fresh.starts[0]!.observedPid=99;},f=>{f.fresh.starts[1]!.instanceId=f.fresh.starts[0]!.instanceId;},
    f=>{f.fresh.stops.pop();},f=>{f.fresh.stops[0]!.pid=99;},f=>{f.fresh.starts[0]!.loadedPlugins[0]!.version='0.0.1';},f=>{f.fresh.starts[0]!.loadedPlugins=[];},f=>{f.fresh.duplicateStarts[0]!.pidPreserved=false;},f=>{f.fresh.counts.modelGenerations=1;},
    f=>{f.upgrade.unknownSendPreserved=false;},f=>{f.upgrade.unknownOperationPreserved=false;},f=>{f.upgrade.matchingRollback=false;},
    f=>{f.upgrade.watermarkPreserved=false;},f=>{f.upgrade.pendingResultPreserved=false;},f=>{f.calibration.readiness.counts.notExecuted=0;},
    f=>{f.calibration.observations.observations.push({actual:'accept'});},f=>{f.calibration.manifest.semanticReliabilityProven=true;}
  ];
  for(const change of changes){const f=fixture();change(f);assert.equal(auditLocalCandidate(binding,f).localReady,false);}
});

function archiveFixture(){
  const root=mkdtempSync(join(testTempDir(),'candidate-seal-')),release=join(root,'release'),evidence=join(root,'evidence');
  mkdirSync(join(release,'node_modules/alpha'),{recursive:true});mkdirSync(evidence);
  saveJson(join(release,'package.json'),{name:'dsh-dafeiyu',version:'1.0.0',dependencies:{alpha:'1.0.0'}});
  saveJson(join(release,'package-lock.json'),{name:'dsh-dafeiyu',version:'1.0.0',packages:{'':{dependencies:{alpha:'1.0.0'}},'node_modules/alpha':{version:'1.0.0'}}});
  saveJson(join(release,'node_modules/alpha/package.json'),{name:'alpha',version:'1.0.0',main:'index.js'});
  writeFileSync(join(release,'node_modules/alpha/index.js'),'module.exports = {};');
  writeFileSync(join(release,'client.js'),'export {};');
  const contentHash=inventoryHash(fileInventory(release,{payload:true}));saveJson(join(release,'release.json'),{version:'1.0.0',contentHash});
  const dependencies=inspectInstalledDependencies(release),backup=join(root,'backup'),after=join(root,'after'),rollback=join(root,'rollback');
  for(const directory of [backup,after,rollback]){mkdirSync(directory);writeFileSync(join(directory,'snapshot.txt'),'unchanged data');}
  saveJson(join(evidence,'upgrade.json'),{from:{directory:release,contentHash,lockHash:dependencies.lockHash,dependencyHash:dependencies.contentHash},backupDirectory:backup,backupFiles:fileInventory(backup),afterUpgradeDirectory:after,afterUpgradeFiles:fileInventory(after),rollbackDirectory:rollback,rollbackFiles:fileInventory(rollback)});
  saveJson(join(root,'candidate.json'),{release:{directory:release,contentHash,manifestHash:fileHash(join(release,'release.json'))},dependencies,evidenceHash:inventoryHash(fileInventory(evidence)),audit:{localReady:true,releaseAccepted:false}});
  return {root,release,evidence,backup,after,rollback,file:join(root,'candidate.json')};
}

test('sealed evidence detects later package, lock, dependency, evidence and backup changes',()=>{
  for(const target of ['payload','manifest','lock','dependency','evidence','backup','after','rollback']){
    const f=archiveFixture();try{
      assert.deepEqual(verifyCandidate(f.file),{unchanged:true,localReady:true,releaseAccepted:false});
      const file=target==='payload'?join(f.release,'client.js'):target==='manifest'?join(f.release,'release.json'):target==='lock'?join(f.release,'package-lock.json'):target==='dependency'?join(f.release,'node_modules/alpha/index.js'):target==='evidence'?join(f.evidence,'extra.json'):join(f[target as 'backup'|'after'|'rollback'],'snapshot.txt');
      writeFileSync(file,'changed');assert.throws(()=>verifyCandidate(f.file),Error,target);
    }finally{rmSync(f.root,{recursive:true,force:true});}
  }
});
