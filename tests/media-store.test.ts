import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { MediaAccess,MediaSourceDescription } from '@dafeiyu/contracts';
import { taskScopeKey } from '@dafeiyu/contracts';
import { MediaStore } from '../packages/media/lib/store.js';
import { testTempDir } from './test-temp.js';

async function fixture(){const root=await mkdtemp(join(testTempDir(),'media-store-')),file=join(root,'media.sqlite'),who={agentId:'fictional-fish',profileId:'media-fixture'},store=new MediaStore(file,who,true),taskId=randomUUID();
  const scope={kind:'task' as const,agentId:who.agentId,taskId,scopeKey:taskScopeKey(who.agentId,taskId)};
  const description:MediaSourceDescription={ref:{provider:'fixture-media',key:'input'},origin:{provider:'fixture-media',scene:{channel:'fixture',account:'local',kind:'local',id:'asset'},key:'input',version:1,hash:'a'.repeat(64),roots:['fictional-source'],detail:{fixture:true}},kind:'document',name:'fictional.txt',mimeHint:'text/plain',bytesHint:null,durationMsHint:null,rangeReadable:false,publicContent:false};
  let valid=true;const guard=()=>{if(!valid)throw new Error('SOURCE_STALE');};
  const access:MediaAccess={origin:description.origin,guard,execution:{view:{runId:randomUUID(),taskId,scope,origin:{kind:'native',producerId:'fixture',requestId:'task'},signal:new AbortController().signal},producer:'fixture',operationId:randomUUID(),startedEventId:randomUUID(),intentVersion:1,motivation:{kind:'explicit-task',basis:[]},inputs:[],admittedSources:[],guard,historyDependencies:[],validateHistory:()=>valid}};
  const bytes=Buffer.from('fictional document'),publish={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,mime:'text/plain',kind:'document' as const,
    coverage:{acquiredBytes:bytes.length,processed:[],exposed:false,gaps:[],completeness:'unknown' as const}};
  const source=store.rememberSource(access,description);const ready=(key='asset')=>{const {id}=store.reserve(access,key,source);return store.publish(access,id,publish,()=>true);};
  return {root,file,who,store,access,description,source,publish,ready,invalidate:()=>{valid=false;},close:()=>store.close()};
}

test('media metadata starts unread and publishes only verified complete bytes with a stable receipt',async()=>{
  const f=await fixture();try{const reserved=f.store.reserve(f.access,'asset',f.source);assert.deepEqual(f.store.reserve(f.access,'asset',f.source),reserved);assert.equal(f.store.read(f.access,reserved.id).state,'staging');
    assert.throws(()=>f.store.publish(f.access,reserved.id,f.publish,()=>false),/BLOB_UNVERIFIED/);const ref=f.store.publish(f.access,reserved.id,f.publish,()=>true);
    assert.deepEqual(f.store.publish(f.access,reserved.id,f.publish,()=>true),ref);assert.equal(f.store.requireRef(f.access,ref).coverage.exposed,false);assert.equal(f.store.counts().bytes,f.publish.bytes);
    assert.throws(()=>f.store.publish(f.access,reserved.id,{...f.publish,sha256:'b'.repeat(64)},()=>true),/IDEMPOTENCY_CONFLICT/);
  }finally{f.close();}
});

test('asset ids, copied metadata, another Task epoch and a different origin never grant access',async()=>{
  const f=await fixture();try{const ref=f.ready(),otherId=randomUUID(),scope={...f.access.execution.view.scope,kind:'task' as const,agentId:f.who.agentId,taskId:otherId,scopeKey:taskScopeKey(f.who.agentId,otherId)};
    assert.throws(()=>f.store.requireRef({...f.access,execution:{...f.access.execution,view:{...f.access.execution.view,scope}}},ref),/SCOPE_DENIED/);
    assert.throws(()=>f.store.requireRef({...f.access,execution:{...f.access.execution,intentVersion:2}},ref),/SCOPE_DENIED/);
    assert.throws(()=>f.store.requireRef({...f.access,origin:{...f.description.origin,key:'other'}},ref),/SCOPE_DENIED/);
    assert.throws(()=>f.store.requireRef(f.access,{...ref,sha256:'b'.repeat(64)}),/UNAVAILABLE/);
  }finally{f.close();}
});

test('source deletion and restoration advance versions and cannot resurrect old assets',async()=>{
  const f=await fixture();try{const ref=f.ready();f.store.changeSource(f.access,f.source.id,1,true);assert.throws(()=>f.store.requireRef(f.access,ref),/SOURCE_STALE/);
    f.store.changeSource(f.access,f.source.id,2,false);assert.throws(()=>f.store.requireRef(f.access,ref),/SOURCE_STALE/);
    const source=f.store.source(f.source.id),reserved=f.store.reserve(f.access,'fresh',source),fresh=f.store.publish(f.access,reserved.id,f.publish,()=>true);assert.notEqual(fresh.id,ref.id);
  }finally{f.close();}
});

test('active leases protect blobs and failed cleanup remains charged until physical removal completes',async()=>{
  const f=await fixture();try{const ref=f.ready(),now=Date.now(),lease=f.store.lease(f.access,ref,'delivery',now+60000);assert.equal(f.store.reclaimable(now).length,0);
    assert.throws(()=>f.store.evict(ref.sha256,now,()=>{}),/PINNED/);assert.equal(f.store.releaseLease(lease,'wrong-owner'),false);assert.equal(f.store.releaseLease(lease,'delivery'),true);
    assert.throws(()=>f.store.evict(ref.sha256,now,()=>{throw new Error('injected-unlink-failure');}),/injected/);
    assert.equal(f.store.read(f.access,ref.id).state,'evicted');assert.equal(f.store.read(f.access,ref.id).version,ref.version);assert.equal(f.store.counts().bytes,ref.bytes);
    assert.equal(f.store.pendingRemoval().length,1);assert.throws(()=>f.store.requireRef(f.access,ref),/UNAVAILABLE/);
    f.store.completeRemoval(ref.sha256,()=>{});assert.equal(f.store.counts().bytes,0);assert.equal(f.store.pendingRemoval().length,0);
    f.ready('other-asset');assert.throws(()=>f.store.requireRef(f.access,ref),/UNAVAILABLE/);
  }finally{f.close();}
});

test('a failed audit transaction cannot leave a published asset or blob row',async()=>{
  const f=await fixture();try{const reserved=f.store.reserve(f.access,'asset',f.source),db=new DatabaseSync(f.file);
    db.exec("CREATE TRIGGER injected BEFORE INSERT ON media_outbox WHEN json_extract(NEW.body,'$.type')='media.asset.ready' BEGIN SELECT RAISE(ABORT,'injected');END;");
    assert.throws(()=>f.store.publish(f.access,reserved.id,f.publish,()=>true),/injected/);assert.equal(f.store.read(f.access,reserved.id).state,'staging');assert.equal(f.store.counts().bytes,0);db.close();
  }finally{f.close();}
});

test('restart preserves verified asset history and interrupts incomplete jobs without inventing observations',async()=>{
  const f=await fixture(),ref=f.ready(),pending=f.store.reserve(f.access,'pending',f.source),job=randomUUID();f.store.beginJob(f.access,job,{fixture:true});f.close();
  const store=new MediaStore(f.file,f.who);try{assert.equal(store.recover(),1);assert.equal(store.requireRef(f.access,ref).sha256,ref.sha256);assert.equal(store.read(f.access,pending.id).state,'failed');assert.equal(store.recover(),0);
    assert.throws(()=>store.finishJob(f.access,job,{text:'not actually read'},null),/JOB_STATE_CONFLICT/);
    const db=new DatabaseSync(f.file,{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM media_exposures').get()?.n,0);}finally{db.close();}
  }finally{store.close();}
});

test('future media schemas and another profile are rejected without initialization',async()=>{
  const f=await fixture();f.close();assert.throws(()=>new MediaStore(f.file,{...f.who,profileId:'other'}),/IDENTITY_MISMATCH/);
  const db=new DatabaseSync(f.file);db.exec('PRAGMA user_version=99');db.close();assert.throws(()=>new MediaStore(f.file,f.who),/SCHEMA_UNSUPPORTED/);
  assert.throws(()=>new MediaStore(join(f.root,'missing.sqlite'),f.who),/MIGRATION_REQUIRED/);
});
