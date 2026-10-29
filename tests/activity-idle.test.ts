import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import type {Context} from '@deepseek-ai/cordis';
import {ActivityConfigSchema} from '@dafeiyu/contracts';
import {ActivityRounds,createRoundSchema} from '../packages/activity/lib/rounds.js';
import {IdleActivity,IdleWorkStore,createIdleSchema} from '../packages/activity/lib/idle.js';
import type {ActivityStore} from '@dafeiyu/activity';
test('idle activity uses one ordinary task and a running activity is not interrupted by its round budget',()=>{
  const db=new DatabaseSync(':memory:');try{createRoundSchema(db);createIdleSchema(db);const rounds=new ActivityRounds(db,{roundTokens:1,roundDurationMs:1},60000),idle=new IdleWorkStore(db),runId=randomUUID(),taskId=randomUUID();let submits=0,state='running';
    const store={rounds,idle,config:ActivityConfigSchema.parse({}),admitIdle:(work:Parameters<IdleWorkStore['save']>[0],now:number)=>{idle.save(work);rounds.admit('idle:'+work.id,now);}} as unknown as ActivityStore;
    const ctx={dafeiyu:{managementUsage:()=>({tokens:2,knownTokens:2,calls:1}),executionProducer:()=>({submitTask:(request:{goal:string})=>{submits++;assert.ok(!request.goal.includes('主人交办的具体任务。')||request.goal.includes('不要'));return {run:{id:runId},task:{id:taskId}};},restoreRun:()=>({id:runId}),status:()=>({state,taskId,error:null,version:1,checkpoints:[]}),pause:()=>assert.fail('A round budget must not pause a running activity')})}} as unknown as Context;
    const controller=new IdleActivity(ctx,store);assert.equal(controller.start(0),true);assert.equal(controller.control(1,false),true);assert.equal(controller.control(100,false),true);assert.equal(rounds.current()?.endedAt,null);state='completed';assert.equal(controller.control(200,false),false);assert.equal(submits,1);assert.equal(rounds.list()[0]?.knownTokens,2);assert.equal(rounds.list()[0]?.reason,'token-budget');
  }finally{db.close();}
});
