import test from 'node:test';
import assert from 'node:assert/strict';
import { experienceFixture } from './memory-experience-fixture.js';

test('personality adoption remains pinned to current experience content while historical inputs survive correction',async()=>{
  const h=await experienceFixture();try{
    const persona=h.memory.personaStore((_access,ref)=>{const value=h.values.get(ref.id);return value?{...value,dependencies:[]}:null;});
    const id=h.store.request(h.access,{requestId:'first',sources:[h.a],reason:'测试经验'});h.store.begin(h.access,id);
    const result=h.store.commit(h.access,id,[h.draft],[]) as {experienceIds:string[];experienceBasis:{id:string;sourceId:string;taskEpoch:number}[]};
    const proposed=persona.propose(h.access,{requestId:'persona',kind:'view',contentRef:h.body,supports:[h.a],counters:[h.b],applicability:'仅虚构场景',reason:'明确选择',experienceBasis:result.experienceBasis});
    const trial=persona.review(h.access,{requestId:'trial',id:proposed.id,expectedVersion:1,state:'trial',reason:'试行'});
    persona.publish(h.access,{requestId:'publish',expectedStageVersion:0,entries:[{id:trial.id,version:trial.version}]});assert.equal(persona.prepare(h.access).entries.length,1);
    const experienceId=result.experienceIds[0]!;h.store.review(h.access,{requestId:'review',id:experienceId,expectedVersion:1,state:'accepted',reason:'有条件采用'});
    assert.equal(persona.prepare(h.access).entries.length,1); // Review did not change the underlying inference.
    const newSource=h.ref('新的虚构反证',['new-root']),newBody=h.ref('修订后的有条件推断',['shared-root','new-root']);
    const access={...h.access,admittedSources:[h.a,h.b,newSource]};
    const second=h.store.request(access,{requestId:'second',sources:[newSource],targets:[{id:experienceId,version:2}],reason:'新证据修订'});h.store.begin(access,second);
    h.store.commit(access,second,[{...h.draft,contentRef:newBody,target:{id:experienceId,version:2},supports:[newSource],counters:[h.a]}],[]);
    assert.equal(h.store.read(access,experienceId).version,3);assert.equal(h.store.sourceCurrent(access,h.body),true);
    assert.equal(persona.prepare(access).entries.length,0);assert.equal(persona.status(access).candidates[0]?.available,false);
    assert.throws(()=>persona.propose(access,{requestId:'stale-proposal',kind:'view',contentRef:h.body,supports:[h.a],counters:[],applicability:'旧意见',reason:'试图复活旧建议',experienceBasis:result.experienceBasis}),/SOURCE_STALE/);
    h.store.review(access,{requestId:'withdraw',id:experienceId,expectedVersion:3,state:'withdrawn',reason:'撤下'});
    assert.equal(h.store.sourceCurrent(access,h.body),false);assert.equal(h.store.sourceCurrent(access,newBody),false);
  }finally{h.close();}
});
