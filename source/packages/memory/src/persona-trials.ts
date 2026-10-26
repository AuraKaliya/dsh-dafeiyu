import type { DatabaseSync } from 'node:sqlite';
import { randomUUID,createHash } from 'node:crypto';
import { z } from 'zod';
import { ContextItemSchema, PersonaTrialSelectInputSchema, PersonaTrialSelectionSchema, PersonaTrialAdmissionInputSchema,
  PersonaTrialAdmissionSchema, PersonaTrialCompletionInputSchema, PersonaTrialOutcomeSchema } from '@dafeiyu/contracts';
import type { PersonaAccess, PersonaCandidate, PersonaTrialSelection, PersonaTrialSelectionRef,
  PersonaTrialSelectInput, PersonaTrialAdmissionInput, PersonaTrialAdmissionRef, PersonaTrialCompletionInput, PersonaTrialOutcomeRef,
  PersonaTrialOutcome, PreparedPersonaTrialEntry, PersonaSourceRef, SourceDependency,Json } from '@dafeiyu/contracts';
import type { PersonaMaterial, PersonaResolver } from './persona-store.js';
import { personaDigest, personaScope, uniqueSources } from './persona-digest.js';
import { PERSONA_ADOPTION_POLICY, describePersonaSources, readPersonaCandidate, readPersonaProof, savePersonaDependencies } from './persona-evidence.js';

interface TrialHost {
  check(access:PersonaAccess,candidate:PersonaCandidate):PersonaMaterial;
  event(access:PersonaAccess,type:string,data:Record<string,Json>):void;
  promoted(access:PersonaAccess,trial:PersonaCandidate,current:PersonaCandidate,requireSelection?:boolean):boolean;
}

/** Trial records are observations of use. Adoption is a separate, revalidated transaction. */
export class PersonaTrialStore {
  constructor(private readonly db:DatabaseSync,private readonly resolve:PersonaResolver,private readonly host:TrialHost){}

  selection(access:PersonaAccess,version?:number):{version:number;body:PersonaTrialSelection|null;ref:PersonaTrialSelectionRef|null} {
    access.guard();const agent=access.view.scope.agentId,scopeKey=personaScope(access.view.scope);
    const selected=version??Number(this.db.prepare('SELECT version FROM persona_trial_selections WHERE agent_id=? AND scope_key=?').get(agent,scopeKey)?.version??0);
    if(selected===0)return {version:0,body:null,ref:null};
    const row=this.db.prepare('SELECT body,body_hash FROM persona_trial_selection_revisions WHERE agent_id=? AND scope_key=? AND version=?').get(agent,scopeKey,selected);
    if(!row)throw new Error('SOURCE_STALE');
    const body=PersonaTrialSelectionSchema.parse(JSON.parse(String(row.body)));
    if(body.agentId!==agent||personaScope(body.scope)!==scopeKey||body.version!==selected||personaDigest(body)!==row.body_hash)throw new Error('PERSONA_STATE_CORRUPT');
    return {version:selected,body,ref:{agentId:agent,scopeKey,version:selected,hash:String(row.body_hash)}};
  }

  select(access:PersonaAccess,raw:PersonaTrialSelectInput) {
    const input=PersonaTrialSelectInputSchema.parse(raw),current=this.selection(access);
    if(current.version!==input.expectedSelectionVersion)throw new Error('VERSION_CONFLICT');
    const dependencies:PersonaSourceRef[]=[];
    for(const entry of input.entries){const candidate=readPersonaCandidate(this.db,access,entry.candidate.id);
      if(candidate.version!==entry.candidate.version)throw new Error('VERSION_CONFLICT');
      if(candidate.state!=='trial')throw new Error('PERSONA_REVIEW_REQUIRED');
      if(entry.applicability!==candidate.applicability)throw new Error('SCOPE_DENIED');
      this.host.check(access,candidate);dependencies.push(candidate.contentRef,...candidate.dependencies);
    }
    return this.writeSelection(access,current.version,input.entries,dependencies);
  }

  private writeSelection(access:PersonaAccess,previousVersion:number,entries:PersonaTrialSelectInput['entries'],dependencies:readonly PersonaSourceRef[]) {
    const body=PersonaTrialSelectionSchema.parse({schemaVersion:1,agentId:access.view.scope.agentId,scope:access.view.scope,version:previousVersion+1,entries,
      runId:access.view.runId,producer:access.producer,createdAt:new Date().toISOString(),policyVersion:PERSONA_ADOPTION_POLICY});
    const scopeKey=personaScope(body.scope),hash=personaDigest(body);
    this.db.prepare('INSERT INTO persona_trial_selections(agent_id,scope_key,version) VALUES(?,?,?) ON CONFLICT(agent_id,scope_key) DO UPDATE SET version=excluded.version').run(body.agentId,scopeKey,body.version);
    this.db.prepare('INSERT INTO persona_trial_selection_revisions(agent_id,scope_key,version,body,body_hash) VALUES(?,?,?,?,?)').run(body.agentId,scopeKey,body.version,JSON.stringify(body),hash);
    for(const entry of body.entries)this.db.prepare('INSERT INTO persona_trial_selection_entries(agent_id,scope_key,selection_version,candidate_id,candidate_version,body,body_hash) VALUES(?,?,?,?,?,?,?)')
      .run(body.agentId,scopeKey,body.version,entry.candidate.id,entry.candidate.version,JSON.stringify(entry),personaDigest(entry));
    savePersonaDependencies(this.db,'selection',JSON.stringify([body.agentId,scopeKey]),body.version,dependencies);
    this.host.event(access,'persona.trial.selected',{version:body.version,count:body.entries.length});
    return {selection:{agentId:body.agentId,scopeKey,version:body.version,hash},entries:body.entries};
  }

  private projection(access:PersonaAccess,selection:PersonaTrialSelection,ref:PersonaTrialSelectionRef,candidate:PersonaCandidate):PreparedPersonaTrialEntry {
    const selected=selection.entries.find(entry=>entry.candidate.id===candidate.id&&entry.candidate.version===candidate.version);
    if(!selected||candidate.state!=='trial')throw new Error('SOURCE_STALE');
    const material=this.host.check(access,candidate),sourceEvidence=describePersonaSources(access,uniqueSources([candidate.contentRef,...candidate.dependencies]),this.resolve);
    const text=JSON.stringify({kind:'stage-persona-trial',projection:'trial',maturity:'tentative',category:candidate.kind,content:material.text,
      applicability:selected.applicability,exitConditions:selected.exitConditions,reason:candidate.reason,
      evidence:sourceEvidence.slice(0,8).map(source=>({nature:source.nature,completeness:source.completeness,coverage:source.coverage.slice(0,4).map(value=>value.slice(0,160))})),
      omittedEvidence:Math.max(0,sourceEvidence.length-8),instructionAuthority:false,notice:'这是正在试行的认识，尚未采用；实际效果和反证仍须核对。'});
    const item=ContextItemSchema.parse({id:`persona-trial:${candidate.id}`,version:`${candidate.version}:${ref.version}`,text,expiresAt:'9999-12-31T23:59:59.999Z',
      sources:[{ref:`dafeiyu:persona-trial:${candidate.id}`,version:`${candidate.version}:${ref.version}`,hash:personaDigest({text,dependencies:candidate.dependencies,selection:ref})}]});
    return {projection:'trial',maturity:'tentative',candidate:{id:candidate.id,version:candidate.version},contentRef:candidate.contentRef,dependencies:candidate.dependencies,
      trialSelection:ref,exitConditions:selected.exitConditions,sourceEvidence,item};
  }

  prepare(access:PersonaAccess) {
    const selection=this.selection(access),entries:PreparedPersonaTrialEntry[]=[];let omitted=0;
    for(const chosen of selection.body?.entries??[]){try{const candidate=readPersonaCandidate(this.db,access,chosen.candidate.id);
      if(candidate.version!==chosen.candidate.version||candidate.state!=='trial')throw new Error('SOURCE_STALE');
      entries.push(this.projection(access,selection.body!,selection.ref!,candidate));
    }catch{access.guard();omitted++;}}
    // Only a Run with a real Admission can keep its exact old trial view through a verified promotion.
    for(const row of this.db.prepare('SELECT body,body_hash FROM persona_trial_admissions WHERE agent_id=? AND scope_key=? AND run_id=?').all(access.view.scope.agentId,personaScope(access.view.scope),access.view.runId)){
      try{const admission=PersonaTrialAdmissionSchema.parse(JSON.parse(String(row.body)));if(personaDigest(admission)!==row.body_hash)throw new Error('PERSONA_STATE_CORRUPT');
        if(entries.some(entry=>entry.candidate.id===admission.candidate.id))continue;
        const current=readPersonaCandidate(this.db,access,admission.candidate.id),prior=readPersonaCandidate(this.db,access,admission.candidate.id,admission.candidate.version);
        if(!this.host.promoted(access,prior,current))continue;
        const old=this.selection(access,admission.selection.version);if(!old.body||!old.ref||personaDigest(old.ref)!==personaDigest(admission.selection))throw new Error('SOURCE_STALE');
        const entry=this.projection(access,old.body,old.ref,prior);if(personaDigest(entry.item)!==admission.projectionHash)throw new Error('SOURCE_STALE');entries.push(entry);
      }catch{access.guard();}
    }
    return {version:selection.version,entries,omitted};
  }

  admit(access:PersonaAccess,raw:PersonaTrialAdmissionInput):PersonaTrialAdmissionRef[] {
    const input=PersonaTrialAdmissionInputSchema.parse(raw);this.assertRun(access,input);const {entries:admittedEntries,...common}=input;
    const prepared=this.prepare(access),refs:PersonaTrialAdmissionRef[]=[];
    for(const entry of admittedEntries){
      const body=PersonaTrialAdmissionSchema.parse({...common,...entry,id:randomUUID(),policyVersion:PERSONA_ADOPTION_POLICY});
      const old=this.db.prepare('SELECT body,body_hash FROM persona_trial_admissions WHERE agent_id=? AND scope_key=? AND run_id=? AND candidate_id=? AND candidate_version=? AND selection_version=?')
        .get(input.agentId,personaScope(input.scope),input.runId,entry.candidate.id,entry.candidate.version,entry.selection.version);
      if(old){const saved=PersonaTrialAdmissionSchema.parse(JSON.parse(String(old.body)));this.sameRecord(saved,body);if(personaDigest(saved)!==old.body_hash)throw new Error('PERSONA_STATE_CORRUPT');refs.push({id:saved.id,hash:String(old.body_hash)});continue;}
      const actual=prepared.entries.find(value=>value.candidate.id===entry.candidate.id&&value.candidate.version===entry.candidate.version);
      if(!actual||entry.selection.version!==input.trialSelectionVersion||personaDigest(actual.trialSelection)!==personaDigest(entry.selection)||personaDigest(actual.item)!==entry.projectionHash||
        personaDigest(actual.contentRef)!==personaDigest(entry.contentRef)||personaDigest(actual.dependencies)!==personaDigest(entry.dependencies)||personaDigest(actual.sourceEvidence)!==personaDigest(entry.sourceEvidence))throw new Error('SOURCE_STALE');
      const selected=this.selection(access,entry.selection.version);if(!selected.body||Date.parse(input.admittedAt)<Date.parse(selected.body.createdAt))throw new Error('PERSONA_TRIAL_EVIDENCE_REQUIRED');
      const hash=personaDigest(body);
      this.db.prepare('INSERT INTO persona_trial_admissions(id,agent_id,scope_key,selection_version,candidate_id,candidate_version,run_id,manifest_hash,body,body_hash) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(body.id,body.agentId,personaScope(body.scope),body.selection.version,body.candidate.id,body.candidate.version,body.runId,body.manifestHash,JSON.stringify(body),hash);
      savePersonaDependencies(this.db,'admission',body.id,1,[body.contentRef,...body.dependencies]);
      this.host.event(access,'persona.trial.admitted',{id:body.id,hash,runId:body.runId,candidate:body.candidate});refs.push({id:body.id,hash});
    }
    return refs;
  }

  complete(access:PersonaAccess,raw:PersonaTrialCompletionInput):PersonaTrialOutcomeRef[] {
    const input=PersonaTrialCompletionInputSchema.parse(raw);this.assertRun(access,input);const refs:PersonaTrialOutcomeRef[]=[];
    for(const row of this.db.prepare('SELECT body,body_hash FROM persona_trial_admissions WHERE agent_id=? AND scope_key=? AND run_id=?').all(input.agentId,personaScope(input.scope),input.runId)){
      const admission=PersonaTrialAdmissionSchema.parse(JSON.parse(String(row.body)));if(personaDigest(admission)!==row.body_hash)throw new Error('PERSONA_STATE_CORRUPT');
      if(Date.parse(input.closedAt)<Date.parse(admission.admittedAt))throw new Error('PERSONA_TRIAL_EVIDENCE_REQUIRED');
      const evidence=new Map([...admission.sourceEvidence,...input.sourceEvidence].map(value=>[personaDigest(value.source),value]));
      const body=PersonaTrialOutcomeSchema.parse({...input,id:randomUUID(),admission:{id:admission.id,hash:String(row.body_hash)},candidate:admission.candidate,selection:admission.selection,
        sourceEvidence:[...evidence.values()],policyVersion:PERSONA_ADOPTION_POLICY});
      const old=this.db.prepare('SELECT body,body_hash FROM persona_trial_outcomes WHERE admission_id=?').get(admission.id);
      if(old){const saved=PersonaTrialOutcomeSchema.parse(JSON.parse(String(old.body)));this.sameRecord(saved,body);if(personaDigest(saved)!==old.body_hash)throw new Error('PERSONA_STATE_CORRUPT');refs.push({id:saved.id,hash:String(old.body_hash)});continue;}
      const hash=personaDigest(body);
      this.db.prepare('INSERT INTO persona_trial_outcomes(id,admission_id,agent_id,scope_key,run_id,body,body_hash) VALUES(?,?,?,?,?,?,?)').run(body.id,admission.id,body.agentId,personaScope(body.scope),body.runId,JSON.stringify(body),hash);
      savePersonaDependencies(this.db,'outcome',body.id,1,[admission.contentRef,...admission.dependencies,...body.sources]);
      this.host.event(access,'persona.trial.completed',{id:body.id,hash,runId:body.runId,candidate:body.candidate,state:body.terminal.state});refs.push({id:body.id,hash});
    }
    return refs;
  }

  private assertRun(access:PersonaAccess,input:PersonaTrialAdmissionInput|PersonaTrialCompletionInput):void {
    access.guard();if(input.agentId!==access.view.scope.agentId||input.runId!==access.view.runId||personaDigest(input.scope)!==personaDigest(access.view.scope))throw new Error('SCOPE_DENIED');
  }
  private sameRecord(saved:{id:string;policyVersion:string},next:{id:string;policyVersion:string}):void {
    if(personaDigest({...saved,id:null,policyVersion:null})!==personaDigest({...next,id:null,policyVersion:null}))throw new Error('IDEMPOTENCY_CONFLICT');
  }
  readOutcome(access:PersonaAccess,ref:PersonaTrialOutcomeRef):PersonaTrialOutcome {
    return readPersonaProof(this.db,access,'persona_trial_outcomes',ref,PersonaTrialOutcomeSchema);
  }
  historical(access:PersonaAccess,dependency:Extract<SourceDependency,{kind:'context'}>):boolean {
    try{access.guard();if(dependency.agentId!==access.view.scope.agentId||dependency.route!==personaScope(access.view.scope))return false;
      const id=/^persona-trial:([a-f0-9-]{36})$/.exec(dependency.id)?.[1],versions=/^(\d+):(\d+)$/.exec(dependency.version);
      if(!id||!versions)return false;const candidateVersion=Number(versions[1]),selectionVersion=Number(versions[2]);
      if(!Number.isSafeInteger(candidateVersion)||!Number.isSafeInteger(selectionVersion))return false;
      const current=readPersonaCandidate(this.db,access,id),prior=readPersonaCandidate(this.db,access,id,candidateVersion);
      if(!(current.state==='trial'&&current.version===prior.version)&&!this.host.promoted(access,prior,current,false))return false;
      const selection=this.selection(access,selectionVersion);if(!selection.body||!selection.ref)return false;
      const entry=this.projection(access,selection.body,selection.ref,prior),projectionHash=personaDigest(entry.item);
      const admitted=this.db.prepare('SELECT body,body_hash FROM persona_trial_admissions WHERE agent_id=? AND scope_key=? AND candidate_id=? AND candidate_version=? AND selection_version=?')
        .all(access.view.scope.agentId,personaScope(access.view.scope),id,candidateVersion,selectionVersion).some(row=>{const body=PersonaTrialAdmissionSchema.parse(JSON.parse(String(row.body)));return personaDigest(body)===row.body_hash&&body.projectionHash===projectionHash;});
      return admitted&&createHash('sha256').update(JSON.stringify([entry.item.text,entry.item.sources])).digest('hex')===dependency.hash;
    }catch{return false;}
  }
  status(access:PersonaAccess) {
    const selection=this.selection(access),outcomes=this.db.prepare('SELECT id,body,body_hash FROM persona_trial_outcomes WHERE agent_id=? AND scope_key=? ORDER BY rowid DESC LIMIT 100').all(access.view.scope.agentId,personaScope(access.view.scope)).map(row=>{
      const body=this.readOutcome(access,{id:String(row.id),hash:String(row.body_hash)});return {ref:{id:body.id,hash:String(row.body_hash)},candidate:body.candidate,runId:body.runId,state:body.terminal.state,gaps:body.gaps};});
    return {trialSelectionVersion:selection.version,trialSelection:selection.ref,trialEntries:selection.body?.entries??[],trialOutcomes:outcomes};
  }
  remove(access:PersonaAccess,ids:readonly string[]):void {
    const current=this.selection(access);if(!current.body||!current.body.entries.some(entry=>ids.includes(entry.candidate.id)))return;
    const entries=current.body.entries.filter(entry=>!ids.includes(entry.candidate.id));
    const dependencies=entries.flatMap(entry=>{const candidate=readPersonaCandidate(this.db,access,entry.candidate.id,entry.candidate.version);return [candidate.contentRef,...candidate.dependencies];});
    this.writeSelection(access,current.version,entries,dependencies);
  }
}
