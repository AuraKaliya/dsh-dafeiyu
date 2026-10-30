import test from 'node:test';
import assert from 'node:assert/strict';
import {workContexts} from '@dafeiyu/contracts';
import type {WorkCallContext} from '@dafeiyu/contracts';

const context=(workItemId:string,cls:WorkCallContext['class']):WorkCallContext=>({
  workItemId,
  runId:'00000000-0000-4000-8000-000000000001',
  scopeKey:'scope',
  class:cls,
  targetVersion:3,
  stage:'execution',
});

test('work context registry binds sessions and jobs, and unbound calls remain diagnosable',()=>{
  workContexts.clear();
  const unbindSession=workContexts.bindSession('session-a',context('task:a','owner-task'));
  const unbindJob=workContexts.bindJob('job-a',context('task:a','owner-task'));
  assert.equal(workContexts.resolveSession('session-a')?.class,'owner-task');
  assert.equal(workContexts.resolveSession('session-a')?.targetVersion,3);
  assert.equal(workContexts.resolveJob('job-a')?.workItemId,'task:a');
  assert.equal(workContexts.resolveSession('missing'),undefined);

  workContexts.noteUnbound({sessionId:'session-b',purpose:'task'});
  const diagnostics=workContexts.diagnostics();
  assert.equal(diagnostics.boundSessions,1);
  assert.equal(diagnostics.boundJobs,1);
  assert.equal(diagnostics.unbound.length,1);
  assert.equal(diagnostics.unbound[0]!.sessionId,'session-b');

  unbindSession();
  unbindJob();
  assert.equal(workContexts.resolveSession('session-a'),undefined);
  assert.equal(workContexts.resolveJob('job-a'),undefined);
  workContexts.clear();
  assert.equal(workContexts.diagnostics().unbound.length,0);
});
