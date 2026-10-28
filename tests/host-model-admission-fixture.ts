import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManagedHost,HostRuntimeOptions } from '@dafeiyu/host';
import { testTempDir } from './test-temp.js';

const scenario=process.argv[2];assert.ok(['mounted','denied','failed'].includes(scenario??''));
const root=await mkdtemp(join(testTempDir(),'host-model-admission-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
process.env.DSH_HOME=join(root,'core/dsh-home');
const {ManagedHost:Host,loadHostConfig,initializeProfile,owners}=await import('@dafeiyu/host');
const {AnalysisRuntime}=await import('../packages/memory/lib/analysis-runtime.js');
const {HostConfigSchema}=await import('@dafeiyu/contracts');
const {ScriptedModel,textReply}=await import('./harness.js');
const {z}=await import('zod');
const config={schemaVersion:1,profileId:'model-admission-fixture',agent:{id:'dafeiyu'},paths:{core:'./core',memory:'./memory',sessions:'./sessions',query:'./query.sqlite',channels:{}},
  persona:{fixedFile:'./persona.md',kind:'test'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},runtime:{turnTimeoutMs:3000,shutdownGraceMs:500},
  plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:"memory-growth",required:true,config:{}}],
  authorityPolicies:[{id:'local',producers:['host-cli'],actions:[],allowLocalWrite:false}]};
assert.throws(()=>HostConfigSchema.parse({...config,installModelAdmission:'./arbitrary-plugin.js'}));
await writeFile(join(root,'persona.md'),'虚构底色，仅检查模型入口与真实本机生命周期。');await writeFile(file,JSON.stringify(config));
const prepared=loadHostConfig(file);initializeProfile(prepared,coordination);
let installed=false,disposed=false,guards=0,modelCalls=0;const phases:string[]=[],sessions:string[]=[];
const adapter=new ScriptedModel(options=>{modelCalls++;assert.equal(installed,true);assert.ok(phases.includes('binding'));return textReply(String(options.sessionId).startsWith('memory-analysis-')?'{"value":"independent-analysis"}':'虚构任务已完成');});
const options:HostRuntimeOptions={adapter,coordination,mode:'single-run',onPhase:phase=>{phases.push(phase);if(phase==='binding')assert.equal(installed,true);},
  installModelAdmission:async(ctx,actual)=>{
    assert.equal(actual,prepared);assert.equal(Object.isFrozen(actual),true);assert.equal(ctx.get('dafeiyu'),undefined);assert.equal(ctx.agents.list().length,0);assert.equal(modelCalls,0);
    ctx.effect(()=>()=>{disposed=true;},'fictional.model-admission.close');
    await new Promise<void>(resolve=>setTimeout(resolve,10));
    if(scenario==='failed')throw new Error('FIXTURE_MODEL_ADMISSION_FAILED');
    ctx.on('llm/stream',async function*(call,next){guards++;sessions.push(String(call.sessionId));assert.equal(installed,true);if(scenario==='denied')throw new Error('FIXTURE_BUDGET_DENIED');yield* next();});
    installed=true;
  }};
let host:ManagedHost|undefined,analysis:InstanceType<typeof AnalysisRuntime>|undefined;
try{
  if(scenario==='failed'){
    await assert.rejects(()=>Host.start(prepared,options),/FIXTURE_MODEL_ADMISSION_FAILED/);assert.equal(phases.includes('binding'),false);assert.equal(modelCalls,0);assert.equal(guards,0);
  }else{
    host=await Host.start(prepared,options);assert.equal(installed,true);assert.equal(guards,0);
    const task=await host.run({requestId:'guard-task',title:'虚构任务',goal:'检查安装时机',policyId:'local'});
    assert.equal(task.state,scenario==='denied'?'failed':'completed');assert.equal(guards,1);assert.equal(modelCalls,scenario==='denied'?0:1);
    analysis=new AnalysisRuntime(host.ctx,join(root,'independent-analysis'));
    const work=analysis.structured({id:'guard-analysis',model:{provider:'local-test',model:'scripted'},instructions:'只返回虚构JSON',input:{purpose:'fixture'},parse:value=>z.strictObject({value:z.literal('independent-analysis')}).parse(value)},new AbortController().signal);
    if(scenario==='denied')await assert.rejects(work);else assert.deepEqual(await work,{value:'independent-analysis'});
    assert.equal(guards,2);assert.equal(modelCalls,scenario==='denied'?0:2);assert.ok(sessions.some(id=>id.startsWith('memory-analysis-')));assert.ok(sessions.some(id=>id.startsWith('dafeiyu-task-')));
  }
}finally{await analysis?.close();await host?.close();}
assert.equal(disposed,true);assert.equal(owners(coordination).length,0);
console.log(JSON.stringify({passed:true,realDsh:true,realModel:false,serverAccess:false}));
