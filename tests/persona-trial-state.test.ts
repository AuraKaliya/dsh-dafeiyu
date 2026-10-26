import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import type { PersonaAccess,PersonaSourceRef,PersonaTrialAdmissionInput,PersonaTrialCompletionInput } from '@dafeiyu/contracts';
import { taskScopeKey } from '@dafeiyu/contracts';
import { experienceFixture } from './memory-experience-fixture.js';
import { personaDigest } from '../packages/memory/lib/persona-digest.js';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
async function fixture(){const h=await experienceFixture();
  const resolve=(access:PersonaAccess,ref:PersonaSourceRef)=>{const value=h.values.get(ref.id);return value&&ref.version===1&&ref.agentId===access.view.scope.agentId&&access.view.scope.kind==='task'&&ref.scopeKey===access.view.scope.scopeKey?{...value,dependencies:[]}:null;};
  const persona=h.memory.personaStore(resolve),candidate=persona.propose(h.access,{requestId:'propose',kind:'value-application',contentRef:h.body,supports:[h.a],counters:[],applicability:'仅虚构雨天试行',reason:'只提出限定候选'});
  const trial=persona.review(h.access,{requestId:'trial',id:candidate.id,expectedVersion:1,state:'trial',reason:'准备实际试行，未采用'});
  const selected=persona.selectTrial(h.access,{requestId:'select-trial',expectedSelectionVersion:0,entries:[{candidate:{id:trial.id,version:trial.version},applicability:'仅虚构雨天试行',exitConditions:['来源撤回或不再适用']}]});
  const access:PersonaAccess={...h.access,view:{...h.access.view,runId:randomUUID()}},entry=persona.prepare(access).trialEntries![0]!,admittedAt=new Date().toISOString();
  const admission:PersonaTrialAdmissionInput={schemaVersion:1,agentId:access.view.scope.agentId,scope:access.view.scope,runId:access.view.runId,manifestHash:hash('fixture manifest'),trialSelectionVersion:selected.selection.version,admittedAt,
    entries:[{candidate:entry.candidate,selection:entry.trialSelection,contentRef:entry.contentRef,dependencies:[...entry.dependencies],projectionHash:personaDigest(entry.item),sourceEvidence:[...entry.sourceEvidence]}]};
  const completion:PersonaTrialCompletionInput={schemaVersion:1,agentId:access.view.scope.agentId,scope:access.view.scope,runId:access.view.runId,
    terminal:{state:'completed',result:{sessionId:'fictional-session',messageSeq:2,turnEndSeq:3,textHash:hash('实际选择的可见结果')}},closedAt:new Date(Date.parse(admittedAt)+1000).toISOString(),closedEventId:randomUUID(),operations:[],sources:[],sourceEvidence:[],gaps:[]};
  return {...h,persona,candidate,trial,selected,access,entry,admission,completion};
}

test('trial selection is separate from adopted state and only an admitted closed use creates an immutable result',async()=>{
  const h=await fixture();try{
    const prepared=h.persona.prepare(h.access);assert.equal(prepared.entries.length,0);assert.equal(prepared.stageRevision,0);assert.equal(prepared.trialEntries?.length,1);
    const text=JSON.parse(prepared.trialEntries![0]!.item.text);assert.equal(text.projection,'trial');assert.equal(text.maturity,'tentative');assert.equal(text.instructionAuthority,false);
    assert.deepEqual(h.persona.completeTrial(h.access,{...h.completion,runId:h.access.view.runId}),[]);
    assert.equal(h.db.prepare('SELECT count(*) n FROM persona_trial_outcomes').get()?.n,0);
    const admissions=h.persona.admitTrial(h.access,h.admission);assert.equal(admissions.length,1);assert.deepEqual(h.persona.admitTrial(h.access,h.admission),admissions);
    const outcomes=h.persona.completeTrial(h.access,h.completion);assert.equal(outcomes.length,1);assert.deepEqual(h.persona.completeTrial(h.access,h.completion),outcomes);
    assert.equal(h.persona.status(h.access).candidates[0]?.state,'trial');assert.equal(h.persona.status(h.access).stageRevision,0);
    assert.equal(h.db.prepare('SELECT count(*) n FROM persona_adoption_decisions').get()?.n,0);
    assert.throws(()=>h.db.prepare("UPDATE persona_trial_outcomes SET body='{}'").run(),/Immutable/);
  }finally{h.close();}
});

test('wrong projections, stale selection and cross-scope callbacks cannot manufacture trial evidence',async()=>{
  const h=await fixture();try{
    assert.throws(()=>h.persona.admitTrial(h.access,{...h.admission,entries:[{...h.admission.entries[0],projectionHash:hash('forged projection')}]}),/SOURCE_STALE/);
    assert.throws(()=>h.persona.admitTrial(h.access,{...h.admission,runId:randomUUID()}),/SCOPE_DENIED/);
    const taskId=randomUUID(),foreign:PersonaAccess={...h.access,view:{...h.access.view,taskId,scope:{kind:'task',agentId:h.access.view.scope.agentId,taskId,scopeKey:taskScopeKey(h.access.view.scope.agentId,taskId)}}};
    assert.equal(h.persona.status(foreign).trialEntries.length,0);assert.throws(()=>h.persona.admitTrial(foreign,h.admission),/SCOPE_DENIED/);
    h.persona.selectTrial(h.access,{requestId:'clear',expectedSelectionVersion:1,entries:[]});
    assert.equal(h.persona.prepare(h.access).trialEntries?.length,0);assert.throws(()=>h.persona.admitTrial(h.access,h.admission),/SOURCE_STALE/);
    assert.equal(h.db.prepare('SELECT count(*) n FROM persona_trial_admissions').get()?.n,0);
  }finally{h.close();}
});

test('closed outcomes retain unknown effects and replay after source withdrawal without reviving a projection',async()=>{
  const h=await fixture();try{
    h.persona.admitTrial(h.access,h.admission);
    const completion:PersonaTrialCompletionInput={...h.completion,terminal:{state:'interrupted',result:null},operations:[{id:randomUUID(),action:'fixture_write',status:'unknown',effects:'unknown',completeness:'unknown',outcomeHash:hash('no outcome')}],gaps:['实际效果未知']};
    h.values.delete(h.a.id);assert.equal(h.persona.prepare(h.access).trialEntries?.length,0);
    const result=h.persona.completeTrial(h.access,completion);assert.equal(result.length,1);assert.deepEqual(h.persona.completeTrial(h.access,completion),result);
    const body=JSON.parse(String(h.db.prepare('SELECT body FROM persona_trial_outcomes').get()?.body));assert.equal(body.terminal.result,null);assert.equal(body.operations[0].effects,'unknown');
    assert.throws(()=>h.persona.completeTrial(h.access,{...completion,closedEventId:randomUUID()}),/IDEMPOTENCY_CONFLICT/);
    assert.equal(h.persona.status(h.access).candidates[0]?.available,false);
  }finally{h.close();}
});

test('trial commands are versioned and do not let proposed candidates or stale ids bypass review',async()=>{
  const h=await fixture();try{
    const other=h.persona.propose(h.access,{requestId:'other',kind:'value-application',contentRef:h.body,supports:[h.a],applicability:'仅虚构雨天试行',reason:'未试行'});
    assert.throws(()=>h.persona.selectTrial(h.access,{requestId:'bad',expectedSelectionVersion:1,entries:[{candidate:{id:other.id,version:1},applicability:'仅虚构雨天试行',exitConditions:['结束']}]}),/PERSONA_REVIEW_REQUIRED/);
    assert.throws(()=>h.persona.selectTrial(h.access,{requestId:'stale',expectedSelectionVersion:0,entries:[]}),/VERSION_CONFLICT/);
    assert.throws(()=>h.persona.completeTrial(h.access,{...h.completion,terminal:{state:'running',result:null}}));
    h.persona.admitTrial(h.access,h.admission);assert.throws(()=>h.persona.completeTrial(h.access,{...h.completion,closedAt:new Date(Date.parse(h.admission.admittedAt)-1).toISOString()}),/PERSONA_TRIAL_EVIDENCE_REQUIRED/);
  }finally{h.close();}
});
