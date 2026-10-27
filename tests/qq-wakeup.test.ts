import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ActivityService,ActivityStore,ACTIVITY_ACTIONS } from '@dafeiyu/activity';
import { qqCapabilityFixture,privateScene } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

test('an explicitly scheduled QQ task uses the existing durable Activity wake and returns a new reminder without replaying history',async t=>{
  let now=Date.now(),activity!:ActivityService,waking=false,chat=0,planning=0;
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true,turnTimeoutMs:30000,extraTaskActions:[...ACTIVITY_ACTIONS],extraPolicies:[{id:'activity-explore',producers:['activity'],actions:[],allowLocalWrite:true}],beforeActivate:async(ctx,root)=>{
    const settings={tickMs:60000,maintenance:false};new ActivityStore(join(root,'core/activity.sqlite'),{agentId:'dafeiyu',profileId:'qq-capability-fixture'},settings,true).close();
    activity=new ActivityService(ctx,{agentId:'dafeiyu',profileId:'qq-capability-fixture',dataDir:join(root,'core'),settings},()=>now,()=>now);activity.recover();activity.activate();activity.start(false);
  }});t.after(async()=>{await activity.close();await h.close();});
  h.setResponse(request=>{const id=String(request.sessionId);
    if(id.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":true,"issues":[]}');
    if(id.startsWith('dafeiyu-delivery-v3-')){if(waking){assert.match(JSON.stringify(request.messages),/scheduled-wake/);return textReply('该喝水啦。');}return textReply('安排好了，一分钟后提醒你。');}
    if(id.startsWith('dafeiyu-task-')){if(waking){assert.match(JSON.stringify(request.messages),/activity-occurrence/);return textReply('这次唤醒是喝水提醒。');}if(++planning===1)return call('dafeiyu_activity_plan',{requestId:'water',goal:'到原QQ私聊提醒主人喝水',trigger:{kind:'once',at:new Date(now+60000).toISOString()}});return textReply('一分钟后提醒喝水的计划已保存。');}
    return ++chat===1?call('qq_task_submit',{requestId:'natural-reminder'}):textReply('');});
  await h.message('一分钟后提醒我喝水',{target:privateScene,id:'9841'});assert.equal(h.platform.sent.length,1);assert.equal(h.core.journal.list().length,1);
  waking=true;now+=60000;await activity.tick();await h.core.whenIdle();assert.equal(h.platform.sent.length,2);assert.match(JSON.stringify(h.platform.sent[1]),/该喝水啦/);assert.equal(h.core.journal.list().length,1);assert.equal(activity.health.error,null);
  await activity.tick();await h.core.whenIdle();assert.equal(h.platform.sent.length,2);
});
