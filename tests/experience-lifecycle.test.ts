import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {taskScopeKey} from '@dafeiyu/contracts';
import {executionHarness} from './execution-fixture.js';
import {textReply} from './harness.js';
import {testTempDir} from './test-temp.js';

test('ordinary completion records a pending experience without starting a second interpretation workflow',async t=>{
  const root=await mkdtemp(join(testTempDir(),'experience-lifecycle-')),h=await executionHarness(root,()=>textReply('完成虚构工作。'),undefined,true,{maintenance:{}});t.after(h.close);
  const accepted=h.port.submitTask({requestId:'one',title:'虚构工作',goal:'完成虚构工作',policyId:'test-policy'});await h.core.whenIdle();
  assert.equal(h.adapter.requests.length,1);const scope={kind:'task' as const,agentId:'dafeiyu',taskId:accepted.task.id,scopeKey:taskScopeKey('dafeiyu',accepted.task.id)};
  assert.equal(h.memory.growth!.autobiography.pending(scope).length,1);assert.equal(h.memory.growth!.autobiography.read(scope,accepted.run.id).thoughts.length,0);
  const db=new DatabaseSync(join(root,'memory/memory.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM maintenance_requests').get()?.n,0);}finally{db.close();}
});
