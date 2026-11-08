import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {MemoryStore} from '@dafeiyu/memory/store';
import {taskScopeKey} from '@dafeiyu/contracts';
import {CapabilityObservations} from '../packages/memory/lib/capability-observations.js';
import {VerifiedJsonCache,publishJson} from '../packages/host/lib/verified-json-cache.js';
import {testTempDir} from './test-temp.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('immutable observation cache never retains rolled-back rows or caches live permission decisions',async()=>{
  const root=await mkdtemp(join(testTempDir(),'proof-cache-')),file=join(root,'memory.sqlite'),memory=new MemoryStore(file),db=new DatabaseSync(file),observations=new CapabilityObservations(db,memory),taskId=randomUUID(),scope={agentId:'fish',route:taskScopeKey('fish',taskId)};
  let allowed=true,checks=0;observations.bind(()=>{checks++;return allowed;});
  const make=(id:string)=>{const body={schemaVersion:1,kind:'observed',scope:{kind:'task',agentId:'fish',taskId,scopeKey:scope.route},origin:{kind:'native',producerId:'fixture',requestId:'request'},runId:randomUUID(),operationId:randomUUID(),producer:'fixture',
    proof:{provider:'fixture',scene:{channel:'qq',account:'100001',kind:'private',id:'200001'},key:id,version:1,hash:'a'.repeat(64),roots:['root'],detail:null},observedHash:'b'.repeat(64),occurredAt:new Date().toISOString(),counts:{received:1,processed:1},coverage:[],history:[],parent:null,selection:null,rawRetained:false};
    db.prepare('INSERT INTO capability_observations VALUES(?,?,?,?,?,?,?,?)').run(id,'fish',scope.route,'fixture',id,'c'.repeat(64),JSON.stringify(body),hash(body));};
  try{const phantom=randomUUID();db.exec('BEGIN');make(phantom);assert.ok(observations.reference(scope,phantom));db.exec('ROLLBACK');assert.equal(observations.reference(scope,phantom),null);
    const id=randomUUID();make(id);const ref=observations.reference(scope,id)!;assert.ok(ref);assert.equal(observations.valid(scope,ref),true);allowed=false;assert.equal(observations.valid(scope,ref),false);assert.equal(checks,2);assert.equal(observations.reference({...scope,agentId:'other'},id),null);
    const detached=observations.reference(scope,id)!;detached.contentHash='f'.repeat(64);assert.equal(observations.reference(scope,id)?.contentHash,ref.contentHash);
    assert.throws(()=>db.prepare("UPDATE capability_observations SET content_hash='corrupt' WHERE id=?").run(id),/Immutable capability observation/);
    // An independent connection simulates file corruption, never a runtime migration shortcut.
    const external=new DatabaseSync(file);external.exec('DROP TRIGGER capability_observation_immutable');external.prepare("UPDATE capability_observations SET content_hash='corrupt' WHERE id=?").run(id);external.close();
    assert.equal(observations.reference(scope,id),null);
  }finally{db.close();memory.close();}
});

test('file proof cache is bounded, checks identity on every read and refuses tampered or missing evidence',async()=>{
  const root=await mkdtemp(join(testTempDir(),'file-proof-cache-'));let parses=0;const cache=new VerifiedJsonCache(raw=>{parses++;return z.object({value:z.number()}).parse(raw);},2,1000,1000);
  const first=join(root,'first.json');publishJson(first,{value:1});assert.equal(cache.get(first).value,1);assert.equal(cache.get(first).value,1);assert.equal(parses,1);
  await writeFile(first,'{"value":"corrupt"}');assert.throws(()=>cache.get(first));await writeFile(first,'{"value":2}');assert.equal(cache.get(first).value,2);
  for(let i=0;i<3;i++){const next=join(root,i+'.json');publishJson(next,{value:i});cache.get(next);}assert.equal(cache.diagnostics().cachedResults,2);
  await unlink(first);assert.throws(()=>cache.get(first));assert.throws(()=>publishJson(join(root,'0.json'),{value:99}),/EEXIST/);
});
