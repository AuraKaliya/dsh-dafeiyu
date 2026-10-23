import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore } from '@dafeiyu/memory/store';
import { legacyMemory,legacySnapshot,legacyHash } from '../build-tests/legacy-memory-fixture.js';

const root=resolve('.runtime/demos',`memory-boundaries-${randomUUID()}`);await mkdir(root,{recursive:true});const file=join(root,'memory.sqlite');
const old=legacyMemory(file),before=legacySnapshot(old.db);old.db.close();let store=new MemoryStore(file);
try{
  const db=new DatabaseSync(file);let migratedRevisions;
  try{assert.deepEqual(legacySnapshot(db),before);assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);migratedRevisions=db.prepare('SELECT count(*) AS n FROM memory_boundaries').get().n;}finally{db.close();}
  const active=store.read(old.scope,old.active.id);assert.ok(active);assert.equal(active.boundary.task.kind,'unassigned');
  assert.deepEqual(store.receipt(old.scope,old.command),old.receipt);assert.equal(store.mutate(old.scope,old.command).duplicate,true);
  const oldFence=legacyHash([[old.parent.id,3],[old.restored.id,3]].sort(([a],[b])=>a.localeCompare(b)));
  assert.equal(store.sourceFence(old.scope,'a'.repeat(64)),oldFence);assert.equal(store.read(old.scope,old.parent.id),null);assert.equal(store.read(old.scope,old.child.id),null);
  assert.equal(store.read({...old.scope,route:'other'},old.active.id,'normal',undefined,'internal'),null);
  const hidden=store.mutate(old.scope,{action:'create',requestId:'internal-only',value:{kind:'experience',claimType:'observation',content:'虚构内部使用资料',sources:[{kind:'timeline',ref:'fictional:source',contentHash:'b'.repeat(64)}]},boundaryPolicy:{externalExpression:'none'}});
  assert.ok(store.read(old.scope,hidden.id,'normal',undefined,'internal'));assert.equal(store.read(old.scope,hidden.id),null);
  store.close();store=new MemoryStore(file);assert.equal(store.read(old.scope,hidden.id),null);
  store.mutate(old.scope,{action:'restore',requestId:'restore-parent',id:old.parent.id,expectedVersion:3,reason:'虚构恢复测试'});
  assert.equal(store.read(old.scope,old.child.id),null);assert.notEqual(store.sourceFence(old.scope,'a'.repeat(64)),oldFence);
  const report={at:new Date().toISOString(),projectVersion:JSON.parse(await readFile(resolve('package.json'),'utf8')).version,samples:'fictional-local-only',model:'not-used',serverAccess:false,
    migration:{from:1,to:3,boundarySchema:2,migratedRevisions,legacyTablesPreservedExactly:true,contentAndSourceHashesPreserved:true,stateVersionsAndGenerationsPreserved:true,
      idempotentReceiptsPreserved:true,oldSourceFencesPreserved:true,legacyTasksLeftUnassigned:true,oldAccessNotExpanded:true},
    internalUseSeparatedFromExpression:true,crossConversationDenied:true,restartPassed:true,restoreAdvancesFence:true,oldChangedDescendantNotReactivated:true,
    note:'All seven legacy tables compared before new writes. Restore is a later explicit fictional operation, not a migration effect.'};
  await writeFile(resolve(root,'result.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve('docs/agent-memory-phase-a-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{store.close();}
