import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ActionOutcomeSchema,ExecutionScopeSchema } from '@dafeiyu/contracts';
import type { ActionCapability,ExecutionContext,PersonaSourceRef,PersonaEntryRef } from '@dafeiyu/contracts';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import { openEvaluationRuntime,evaluationCall,evaluationText } from '../../scripts/evaluation/runtime.ts';
import { auditPersonaChanges,capturePersonaBaseline } from '../../scripts/evaluation/persona-proof.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');

test('actual Core, Memory and scripted DSH produce an auditable three-Run tentative adoption with zero paid calls',async()=>{
  const repository=resolve('.'),catalog=new EvaluationCatalog(repository),
    workspace=await EvaluationWorkspace.create(repository,join(await mkdtemp(join(tmpdir(),'persona-runtime-proof-')),'run'),catalog,'a'.repeat(40)),
    attemptId=workspace.ledger.begin('B02-neutral-1'),root=join(workspace.root,'cases',attemptId,'profile'),
    extensionId='evaluation-persona-proof',applicability='只用于本次公开虚构文字练习',content='本次文字练习先核对局部事实，保留未知范围，再决定怎样回应。';
  let phase:'prepare'|'use'|'publish'='prepare',step=0,useRunId='';
  const state:{source?:PersonaSourceRef;trial?:PersonaEntryRef}={};
  const open=(create:boolean)=>openEvaluationRuntime({root,create,foundationFile:join(workspace.root,'sources/persona.foundation.md'),ledger:workspace.ledger,attemptId,
    response:()=>{step++;if(phase==='prepare'){const action=['fixture_proof_observe','fixture_proof_choose'][step-1];return action?evaluationCall(action,{}):evaluationText('已经提出并选择试行，尚未采用。');}
      if(phase==='publish'&&step===1)return evaluationCall('fixture_proof_publish',{});
      return evaluationText(phase==='use'?'本次练习先核对局部事实，并保留了没有资料的范围；实际平台效果尚未知。':'已根据闭合试行评审采用仍暂定的认识，没有提升为稳定偏好。');},
    extension:ctx=>{
      const persona=()=>{assert.ok(ctx.dafeiyuMemory.growth);return ctx.dafeiyuMemory.growth;};
      const action=(id:string,execute:(context:ExecutionContext)=>unknown):ActionCapability=>({id,version:'1',description:'仅本机脚本后端接口对照；不是正式语义验收。',effects:'local-write',requiresTask:true,inputSchema:z.strictObject({}),outputSchema:z.json(),
        execute:async(_input,context)=>ActionOutcomeSchema.parse({status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse(execute(context)),sources:id==='fixture_proof_observe'&&state.source?[{id:state.source.id,scopeKey:state.source.scopeKey,version:state.source.version,contentHash:state.source.contentHash}]:[],receipts:[]})});
      return {id:extensionId,version:'1',actions:[
        action('fixture_proof_observe',context=>{
          state.source=persona().recordObservation(context,{requestId:'source',text:'公开虚构记录：蓝灯只有一次局部文字练习，没有观察真实平台效果。',kind:'primary',nature:'synthetic',occurredAt:new Date().toISOString(),resource:'fixture:proof',coverage:['合成文字局部练习'],completeness:'partial',dependencies:[]},extensionId);
          persona().selectEvidence(context,{requestId:'source-selection',expectedVersion:0,entries:[state.source],reason:'本机合成接口对照输入'},extensionId);return {source:state.source};
        }),
        action('fixture_proof_choose',context=>{
          assert.ok(state.source);const proposed=persona().propose(context,{requestId:'propose',kind:'value-application',text:content,sources:['execution-source:'+state.source.id],counters:[],applicability,reason:'只提出有限暂定认识'},extensionId),
            trial=persona().review(context,{requestId:'trial',id:proposed.id,expectedVersion:proposed.version,state:'trial',reason:'下一轮实际试行，保留反证和未知范围'},extensionId);
          state.trial={id:trial.id,version:trial.version};const selected=persona().selectTrial(context,{requestId:'select-trial',expectedSelectionVersion:0,entries:[{candidate:state.trial,applicability,exitConditions:['来源撤回或出现反例时退出']}]},extensionId);
          return {trial,selected};
        }),
        action('fixture_proof_publish',context=>{
          assert.ok(state.source);assert.ok(state.trial);const status=persona().status(context,extensionId),outcome=status.trialOutcomes.find(value=>value.runId===useRunId);
          assert.ok(outcome);const reviewed=persona().reviewAdoption(context,{requestId:'adoption-review',candidate:state.trial,trialOutcomes:[outcome.ref],supports:['execution-source:'+state.source.id],counters:[],
            counterCheck:{status:'not-obtained',reason:'尚未取得真实平台反证'},conclusionScope:applicability,targetMaturity:'tentative',limitations:['仅有合成文字试行；真实效果和反证仍未知。'],reason:'只在原适用范围内保留暂定认识'},extensionId);
          assert.equal(reviewed.eligibility,'allowed',JSON.stringify(reviewed));return persona().publish(context,{requestId:'publish',expectedStageVersion:status.stageRevision,entries:[{...state.trial,review:reviewed.review}]},extensionId);
        }),
      ]};
    }});
  let runtime=await open(true);
  try{
    const prepared=runtime.port.submitTask({requestId:'prepare',title:'本机合成接口对照',goal:'准备一个有限的价值应用试行，保持未知与反证边界。',policyId:'case'});
    await runtime.core.whenIdle();assert.equal(runtime.port.status(prepared.run).state,'completed');assert.ok(state.trial);
    await runtime.close();const baseline=capturePersonaBaseline(root);assert.equal(baseline.revisions.length,2);
    phase='use';step=0;runtime=await open(false);const task=runtime.port.openTask(prepared.task.id),
      used=runtime.port.submitTask({requestId:'use',taskId:task.id,expectedVersion:1,policyId:'case'},task);useRunId=used.run.id;
    await runtime.core.whenIdle();assert.equal(runtime.port.status(used.run).state,'completed');assert.ok(runtime.adapter.requests.some(request=>JSON.stringify(request.messages).includes(content)));
    phase='publish';step=0;const published=runtime.port.submitTask({requestId:'publish',taskId:task.id,expectedVersion:1,policyId:'case'},task);
    await runtime.core.whenIdle();assert.equal(runtime.port.status(published.run).state,'completed');
    await runtime.close();const scope=(()=>{const db=new DatabaseSync(join(root,'core/runtime.sqlite'),{readOnly:true});
      try{return z.object({scope:ExecutionScopeSchema}).parse(JSON.parse(String(db.prepare('SELECT definition FROM runs WHERE id=?').get(published.run.id)?.definition))).scope;}finally{db.close();}})();
    const proof=await auditPersonaChanges(root,baseline,scope,published.run.id);
    assert.equal(proof.qualificationPassed,true,JSON.stringify(proof.issues));assert.equal(proof.currentProtectionPassed,true,JSON.stringify(proof.current));
    assert.equal(proof.qualified.length,1);assert.equal(proof.qualified[0]?.outcomes[0]?.runId,useRunId);assert.equal(proof.qualified[0]?.maturity,'tentative');
    assert.equal(proof.semanticAssessment,'not-performed');assert.equal(workspace.ledger.budget.spent,0);assert.equal(workspace.config.mode,'offline');
  }finally{await runtime.close();workspace.close();}
});
