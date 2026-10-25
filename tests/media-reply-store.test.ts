import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MediaStore } from '@dafeiyu/media';
import { mediaHash } from '../packages/media/lib/store.js';
import { mediaIoFixture,byteChunks } from './media-io-fixture.js';
import { ReplyMediaManifestSchema } from '@dafeiyu/contracts';

async function draftFixture(){const f=await mediaIoFixture(),access=f.access.execution;const asset=await f.files.ingest(f.access,'source',f.source,{bytes:4,mime:'text/plain',stream:byteChunks(Buffer.from('body'))},new AbortController().signal);
  const content={schemaVersion:1 as const,runId:access.view.runId,scope:access.view.scope,taskEpoch:access.intentVersion,parts:[{kind:'asset' as const,asset,source:f.source.description}]};
  const authority={schemaVersion:1 as const,id:randomUUID(),runId:content.runId,operationId:access.operationId,scope:content.scope,intentVersion:content.taskEpoch,hash:mediaHash(content)};
  const first=f.store.replies.prepare(access,{requestId:'first',expectedVersion:0,content,authority});return {...f,access,asset,content,authority,first};}

test('draft changes require the actual scope/epoch and expected version, while retries preserve their original receipt',async()=>{
  const f=await draftFixture();try{assert.equal(f.store.replies.prepare(f.access,{requestId:'first',expectedVersion:0,content:f.content,authority:f.authority}).id,f.first.id);
    assert.throws(()=>f.store.replies.prepare(f.access,{requestId:'other',expectedVersion:0,content:f.content,authority:f.authority}),/VERSION_CONFLICT/);
    assert.throws(()=>f.store.replies.prepare(f.access,{requestId:'forged',expectedVersion:1,content:{...f.content,runId:randomUUID()},authority:f.authority}),/SCOPE_DENIED/);
    const cancelled=f.store.replies.prepare(f.access,{requestId:'cancel',expectedVersion:1,content:{...f.content,parts:[]},authority:f.authority});assert.equal(cancelled.version,2);assert.equal(f.store.replies.current(f.content.runId)?.draft.parts.length,0);
    assert.equal(f.store.replies.draft(f.first.id).parts.length,1);f.invalidate();assert.throws(()=>f.store.replies.prepare(f.access,{requestId:'expired',expectedVersion:2,content:f.content,authority:f.authority}),/SOURCE_STALE/);
  }finally{f.close();}
});

test('freezing requires corresponding real leases and stays fixed through restart and terminal state',async()=>{
  const f=await draftFixture();let closed=false;try{const id=randomUUID(),expiresAt=new Date(Date.now()+60000).toISOString(),manifest=ReplyMediaManifestSchema.parse({schemaVersion:1,id,replyId:'fixture-reply',runId:f.content.runId,target:f.source.description.origin.scene,sourceMessageId:'fixture',anchor:{kind:'reply',inboundId:randomUUID()},textHash:'a'.repeat(64),draft:{id:f.first.id,version:1},parts:[{kind:'file',asset:f.asset,name:'fixture.txt'}],sourceStamp:'b'.repeat(64),credential:'c'.repeat(64),expiresAt});
    assert.throws(()=>f.store.replies.freeze(f.first,manifest,[],()=>{}),/BINDING_INVALID/);assert.throws(()=>f.store.replies.freeze(f.first,manifest,[{id:randomUUID(),owner:'media-export:'+id}],()=>{}),/LEASE_REQUIRED/);
    const owner='media-export:'+id,lease=f.store.lease({...f.access,execution:f.access,origin:f.source.description.origin,guard:f.access.guard},f.asset,owner,Date.parse(expiresAt));
    const frozen=f.store.replies.freeze(f.first,manifest,[{id:lease,owner}],()=>{});assert.equal(frozen.state,'ready');assert.throws(()=>f.store.replies.prepare(f.access,{requestId:'late',expectedVersion:1,content:f.content,authority:f.authority}),/DRAFT_FROZEN/);
    assert.throws(()=>f.store.replies.freeze(f.first,{...manifest,parts:[{kind:'file',asset:{...f.asset,sha256:'d'.repeat(64)},name:'changed'}]},[{id:lease,owner}],()=>{}),/BINDING_INVALID/);
    const file=join(f.directory,'media.sqlite');f.close();closed=true;const reopened=new MediaStore(file,{agentId:'fixture',profileId:'fixture'});try{assert.deepEqual(reopened.replies.exported(manifest.replyId)?.manifest,manifest);reopened.replies.settle(manifest.replyId,'unknown');assert.equal(reopened.replies.exported(manifest.replyId)?.state,'unknown');assert.throws(()=>reopened.replies.settle(manifest.replyId,'sent'),/STATE_CONFLICT/);}finally{reopened.close();}
  }finally{if(!closed)f.close();}
});

test('media v1 upgrade is explicit and preserves existing assets, hashes and source revisions',async()=>{
  const f=await draftFixture(),file=join(f.directory,'media.sqlite');f.close();const db=new DatabaseSync(file);
  const before=db.prepare('SELECT * FROM media_asset_revisions').all();db.exec('DROP TABLE media_reply_exports;DROP TABLE media_reply_heads;DROP TABLE media_reply_drafts;PRAGMA user_version=1;');db.close();const bytes=await readFile(file);
  assert.throws(()=>new MediaStore(file,{agentId:'fixture',profileId:'fixture'}),/MIGRATION_REQUIRED/);assert.deepEqual(await readFile(file),bytes);
  const migrated=new MediaStore(file,{agentId:'fixture',profileId:'fixture'},false,true);assert.deepEqual(migrated.replies.counts(),{drafts:0,exports:0});migrated.close();const after=new DatabaseSync(file);try{assert.deepEqual(after.prepare('SELECT * FROM media_asset_revisions').all(),before);assert.equal(after.prepare('PRAGMA user_version').get()?.user_version,2);}finally{after.close();}
});
