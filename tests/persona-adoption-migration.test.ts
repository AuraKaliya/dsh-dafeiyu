import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { PersonaCandidateRevisionSchema, PersonaCandidateRevisionV1Schema, PersonaStageSchema } from '@dafeiyu/contracts';
import { MemoryStore, MEMORY_SCHEMA_VERSION, PERSONA_ADOPTION_TABLES } from '@dafeiyu/memory/store';
import { inspectStorage, planMigration } from '@dafeiyu/host';
import { personaDigest } from '../packages/memory/lib/persona-digest.js';
import { dropPersonaAdoptionFixtureSchema } from './legacy-execution-fixture.js';
import { migrationFixture } from './runtime-migration-fixture.js';
import { testTempDir } from './test-temp.js';

const hash='b'.repeat(64), agent='legacy-fixture', scopeKey='fixture:persona-adoption';
const body=JSON.stringify({fixture:'storage constraints only'}), bodyHash=personaDigest(JSON.parse(body));
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
function tableNames(db:DatabaseSync):string[]{return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name));}
function snapshot(db:DatabaseSync,names:readonly string[]){return names.map(name=>({name,rows:db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all()}));}

function seedLegacy(db:DatabaseSync){
  const id=randomUUID(),source={kind:'execution-source' as const,id:randomUUID(),agentId:agent,scopeKey,version:1,contentHash:hash};
  const candidate=PersonaCandidateRevisionV1Schema.parse({schemaVersion:1,id,agentId:agent,version:1,state:'adopted',kind:'preference',
    contentRef:source,supports:[],counters:[],dependencies:[source],rootSources:[],scope:{kind:'conversation',agentId:agent,route:scopeKey},
    motivation:{kind:'unknown',basis:[]},applicability:'legacy fictional scope',reason:'legacy body must not be rewritten',runId:randomUUID(),
    producer:'fixture',createdAt:'2026-10-24T00:00:00.000Z',policyVersion:hash});
  const encoded=JSON.stringify(candidate),digest=personaDigest(candidate);
  db.prepare('INSERT INTO persona_candidates VALUES(?,?,?,?)').run(id,agent,1,'adopted');
  db.prepare('INSERT INTO persona_candidate_revisions VALUES(?,?,?,?)').run(id,1,encoded,digest);
  const stage=PersonaStageSchema.parse({schemaVersion:1,agentId:agent,revision:1,entries:[{id,version:1}],createdAt:candidate.createdAt,policyVersion:hash});
  db.prepare('INSERT INTO persona_profiles VALUES(?,?)').run(agent,1);
  db.prepare('INSERT INTO persona_profile_revisions VALUES(?,?,?,?)').run(agent,1,JSON.stringify(stage),personaDigest(stage));
  const receipt='{"stageRevision":1,"selectionVersion":1,"entries":[{"id":"'+id+'","version":1}]}';
  db.prepare('INSERT INTO persona_requests VALUES(?,?,?,?,?)').run(agent,'fixture','old-publish',hash,receipt);
  const selection=JSON.stringify({schemaVersion:1,entries:[{id,version:1}]});
  db.prepare('INSERT INTO growth_selections VALUES(?,?,?,?)').run(agent,scopeKey,1,selection);
  db.prepare('INSERT INTO growth_revisions VALUES(?,?,?,?)').run(agent,scopeKey,1,selection);
  return {id,encoded,digest,receipt};
}

async function v11Fixture(){
  const root=await mkdtemp(join(testTempDir(),'persona-adoption-migration-')),file=join(root,'memory.sqlite');
  new MemoryStore(file).close();
  const db=new DatabaseSync(file);
  try{
    db.exec('PRAGMA foreign_keys=ON');dropPersonaAdoptionFixtureSchema(db);db.exec('PRAGMA user_version=11');
    const legacy=seedLegacy(db),names=tableNames(db).filter(name=>name!=='memory_schema_migrations');
    return {root,file,legacy,names,before:snapshot(db,names),migrationRows:db.prepare('SELECT * FROM memory_schema_migrations ORDER BY version').all()};
  }finally{db.close();}
}

test('v11 to v12 preserves every legacy row and hash without inventing trial or adoption proofs',async()=>{
  const f=await v11Fixture();assert.equal(inspectStorage(f.file,'memory').version,11);
  for(let attempt=0;attempt<2;attempt++)new MemoryStore(f.file).close();
  const db=new DatabaseSync(f.file,{readOnly:true});try{
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,MEMORY_SCHEMA_VERSION);
    assert.equal(MEMORY_SCHEMA_VERSION,12);assert.deepEqual(snapshot(db,f.names),f.before);
    assert.deepEqual(db.prepare('SELECT * FROM memory_schema_migrations WHERE version<=11 ORDER BY version').all(),f.migrationRows);
    assert.equal(db.prepare('SELECT count(*) AS n FROM memory_schema_migrations WHERE version=12').get()?.n,1);
    for(const table of PERSONA_ADOPTION_TABLES)assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0);
    const row=db.prepare('SELECT body,body_hash FROM persona_candidate_revisions WHERE id=? AND version=1').get(f.legacy.id);
    assert.equal(row?.body,f.legacy.encoded);assert.equal(row?.body_hash,f.legacy.digest);
    const parsed=PersonaCandidateRevisionSchema.parse(JSON.parse(String(row?.body)));
    assert.equal(parsed.schemaVersion,1);assert.equal('adoption' in parsed,false);assert.equal('maturity' in parsed,false);
    assert.equal(db.prepare("SELECT receipt FROM persona_requests WHERE request_id='old-publish'").get()?.receipt,f.legacy.receipt);
  }finally{db.close();}
  assert.equal(inspectStorage(f.file,'memory').supported,true);
});

test('an interrupted additive migration rolls back new tables and retries without altering legacy data',async()=>{
  const f=await v11Fixture();let db=new DatabaseSync(f.file);
  db.exec('CREATE TABLE persona_trial_outcomes(blocker TEXT); INSERT INTO persona_trial_outcomes VALUES(\'retain\')');db.close();
  assert.throws(()=>new MemoryStore(f.file),/already exists/);
  db=new DatabaseSync(f.file);try{
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,11);assert.deepEqual(snapshot(db,f.names),f.before);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='persona_trial_selections'").get()?.n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM memory_schema_migrations WHERE version=12').get()?.n,0);
    assert.equal(db.prepare('SELECT blocker FROM persona_trial_outcomes').get()?.blocker,'retain');db.exec('DROP TABLE persona_trial_outcomes');
  }finally{db.close();}
  new MemoryStore(f.file).close();assert.equal(inspectStorage(f.file,'memory').version,12);
});

/** Deliberately bypasses domain APIs to exercise only physical foreign keys, history retention and backup. */
function insertStorageProofGraph(db:DatabaseSync,candidateId:string){
  const runId=randomUUID(),admission=randomUUID(),outcome=randomUUID(),review=randomUUID(),decision=randomUUID();
  db.prepare('INSERT INTO persona_trial_selections VALUES(?,?,?)').run(agent,scopeKey,1);
  db.prepare('INSERT INTO persona_trial_selection_revisions VALUES(?,?,?,?,?)').run(agent,scopeKey,1,body,bodyHash);
  db.prepare('INSERT INTO persona_trial_selection_entries VALUES(?,?,?,?,?,?,?)').run(agent,scopeKey,1,candidateId,1,body,bodyHash);
  db.prepare('INSERT INTO persona_trial_admissions VALUES(?,?,?,?,?,?,?,?,?,?)').run(admission,agent,scopeKey,1,candidateId,1,runId,hash,body,bodyHash);
  db.prepare('INSERT INTO persona_trial_outcomes VALUES(?,?,?,?,?,?,?)').run(outcome,admission,agent,scopeKey,runId,body,bodyHash);
  db.prepare('INSERT INTO persona_adoption_reviews VALUES(?,?,?,?,?,?,?,?,?)').run(review,agent,scopeKey,candidateId,1,runId,'fixture',body,bodyHash);
  db.prepare('INSERT INTO persona_adoption_review_outcomes VALUES(?,?)').run(review,outcome);
  db.prepare('INSERT INTO persona_adoption_decisions VALUES(?,?,?,?,?,?,?,?,?)').run(decision,review,agent,scopeKey,candidateId,1,'allowed',body,bodyHash);
  db.prepare('INSERT INTO persona_adoption_dependencies VALUES(?,?,?,?,?,?)').run('review',review,1,'fixture-source',body,bodyHash);
  return {runId,admission,outcome,review,decision};
}

test('proof storage enforces exact candidate and selection references, uniqueness and append-only history',async()=>{
  const f=await v11Fixture();new MemoryStore(f.file).close();
  const db=new DatabaseSync(f.file);try{
    db.exec('PRAGMA foreign_keys=ON');const graph=insertStorageProofGraph(db,f.legacy.id);
    assert.equal(db.prepare('PRAGMA foreign_key_check').get(),undefined);
    assert.throws(()=>db.prepare('INSERT INTO persona_trial_outcomes VALUES(?,?,?,?,?,?,?)').run(randomUUID(),randomUUID(),agent,scopeKey,graph.runId,body,bodyHash),/FOREIGN KEY/);
    assert.throws(()=>db.prepare('INSERT INTO persona_trial_outcomes VALUES(?,?,?,?,?,?,?)').run(randomUUID(),graph.admission,agent,scopeKey,graph.runId,body,bodyHash),/UNIQUE/);
    assert.throws(()=>db.prepare('INSERT INTO persona_trial_selection_entries VALUES(?,?,?,?,?,?,?)').run(agent,scopeKey,1,f.legacy.id,99,body,bodyHash),/FOREIGN KEY/);
    assert.throws(()=>db.prepare('INSERT INTO persona_trial_admissions VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),agent,scopeKey,1,f.legacy.id,1,graph.runId,hash,body,bodyHash),/UNIQUE/);
    for(const table of PERSONA_ADOPTION_TABLES.filter(name=>name!=='persona_trial_selections')){
      const column=table==='persona_adoption_review_outcomes'?'outcome_id':'body';
      assert.throws(()=>db.exec(`UPDATE ${table} SET ${column}=${column}`),/Immutable/);
      assert.throws(()=>db.exec(`DELETE FROM ${table}`),/Retain/);
    }
    assert.throws(()=>db.exec('UPDATE persona_trial_selections SET version=version'),/must advance/);
    assert.throws(()=>db.exec("UPDATE persona_trial_selections SET scope_key='another-scope',version=2"),/same scope/);
    assert.throws(()=>db.exec('DELETE FROM persona_trial_selections'),/Retain/);
  }finally{db.close();}
});

test('v12 preflight detects missing proof tables and runtime refuses missing immutable guards',async()=>{
  const f=await v11Fixture();new MemoryStore(f.file).close();
  let db=new DatabaseSync(f.file);db.exec('DROP TABLE persona_adoption_dependencies');db.close();
  assert.equal(inspectStorage(f.file,'memory').supported,false);assert.throws(()=>new MemoryStore(f.file),/no such table/);
  const second=await v11Fixture();new MemoryStore(second.file).close();
  db=new DatabaseSync(second.file);db.exec('DROP TRIGGER persona_trial_outcomes_immutable');db.close();
  assert.equal(inspectStorage(second.file,'memory').supported,false);
  assert.throws(()=>new MemoryStore(second.file),/Unsupported persona adoption trigger/);
});

test('future memory versions are refused before writing',async()=>{
  const f=await v11Fixture(),db=new DatabaseSync(f.file);db.exec('PRAGMA user_version=99');db.close();
  const before=await readFile(f.file);assert.throws(()=>new MemoryStore(f.file),/Unsupported memory database/);
  assert.deepEqual(await readFile(f.file),before);assert.equal(inspectStorage(f.file,'memory').supported,false);
});

test('host migration plans and SQLite backups include all new proof tables and their rows',async()=>{
  const f=await migrationFixture(),file=join(f.memoryDir,'memory.sqlite');new MemoryStore(file).close();
  let db=new DatabaseSync(file);try{db.exec('PRAGMA foreign_keys=ON');const legacy=seedLegacy(db);insertStorageProofGraph(db,legacy.id);}finally{db.close();}
  const plan=await planMigration(f),memoryPlan=plan.files.find(item=>item.kind==='memory');
  assert.ok(memoryPlan);for(const table of PERSONA_ADOPTION_TABLES)assert.ok(memoryPlan.rows.some(row=>row.table===table));
  const destination=join(f.root,'proof-backup.sqlite');db=new DatabaseSync(file,{readOnly:true});
  try{await backup(db,destination);const copied=new DatabaseSync(destination,{readOnly:true});try{
    assert.deepEqual(snapshot(copied,PERSONA_ADOPTION_TABLES),snapshot(db,PERSONA_ADOPTION_TABLES));
    assert.equal(copied.prepare('PRAGMA user_version').get()?.user_version,12);
  }finally{copied.close();}}finally{db.close();}
});
