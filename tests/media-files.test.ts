import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir,writeFile,symlink,mkdir,stat } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mediaIoFixture,byteChunks } from './media-io-fixture.js';
import { hashFile } from '../packages/media/lib/files.js';
const signal=()=>new AbortController().signal;

test('real byte acquisition hashes exact data and exposes no processing claim; pinned data survives quota pressure',async()=>{
  const f=await mediaIoFixture(20);try{const first=Buffer.from('123456789012'),ref=await f.files.ingest(f.access,'a',f.source,{bytes:first.length,mime:'text/plain',stream:byteChunks(first)},signal());
    const file=await f.files.verified(ref);assert.deepEqual(await readFile(file),first);assert.equal(f.store.read(f.access,ref.id).coverage.exposed,false);
    const lease=f.store.lease(f.access,ref,'delivery',Date.now()+60000);await assert.rejects(f.files.ingest(f.access,'b',f.source,{bytes:12,mime:'text/plain',stream:byteChunks(Buffer.from('abcdefghijkl'))},signal()),/MEDIA_CACHE_FULL/);
    assert.deepEqual(await readFile(file),first);f.store.releaseLease(lease,'delivery');
    const second=await f.files.ingest(f.access,'c',f.source,{bytes:12,mime:'text/plain',stream:byteChunks(Buffer.from('abcdefghijkl'))},signal());assert.equal(f.store.read(f.access,ref.id).state,'evicted');assert.equal(f.store.counts().bytes,12);
    assert.equal((await hashFile(await f.files.verified(second))).sha256,second.sha256);assert.deepEqual(await readdir(f.files.work),[]);
  }finally{f.close();}
});

test('truncated streams, size overflow and source revocation never publish half assets',async()=>{
  const f=await mediaIoFixture(32);try{
    await assert.rejects(f.files.ingest(f.access,'short',f.source,{bytes:9,mime:'text/plain',stream:byteChunks(Buffer.from('short'))},signal()),/TRUNCATED/);
    await assert.rejects(f.files.ingest(f.access,'large',f.source,{bytes:null,mime:'text/plain',stream:byteChunks(Buffer.alloc(40))},signal()),/SIZE_LIMIT/);
    async function* revoked(){yield Buffer.from('first');f.invalidate();yield Buffer.from('last');}
    await assert.rejects(f.files.ingest(f.access,'revoke',f.source,{bytes:null,mime:'text/plain',stream:revoked()},signal()),/SOURCE_STALE/);
    assert.equal(f.store.counts().bytes,0);assert.deepEqual(await readdir(f.files.work),[]);
  }finally{f.close();}
});

test('a blocked provider cannot delay cancellation and the acquisition file is reclaimed',async()=>{
  const f=await mediaIoFixture();try{const abort=new AbortController();async function* blocked(){yield Buffer.from('part');await new Promise(()=>{});}
    const pending=f.files.ingest(f.access,'blocked',f.source,{bytes:null,mime:'text/plain',stream:blocked()},abort.signal);setTimeout(()=>abort.abort(),50);
    await assert.rejects(pending,/MEDIA_CANCELLED|AbortError/);assert.deepEqual(await readdir(f.files.work),[]);
  }finally{f.close();}
});

test('altered blobs and filesystem aliases are not accepted as verified media',async()=>{
  const f=await mediaIoFixture();try{const ref=await f.files.ingest(f.access,'a',f.source,{bytes:4,mime:'text/plain',stream:byteChunks(Buffer.from('safe'))},signal()),path=await f.files.path(ref.sha256);
    await writeFile(path,'evil');await assert.rejects(f.files.verified(ref),/BLOB_CORRUPT/);
    const alias=join(f.files.work,'outside');await symlink(f.directory,alias,'junction');
    const {contained}=await import('../packages/media/lib/process.js');await assert.rejects(contained(f.files.root,alias),/PATH_ESCAPE/);
  }finally{f.close();}
});

test('startup recovery removes only owned work and reserved uncommitted blobs',async()=>{
  const f=await mediaIoFixture();try{
    const bytes=Buffer.from('uncommitted'),sha256=createHash('sha256').update(bytes).digest('hex'),asset=f.store.reserve(f.access,'crashed',f.source);
    assert.equal(f.store.reserveBlob(f.access,asset.id,sha256,bytes.length),true);await writeFile(await f.files.path(sha256),bytes);
    const processDirectory=join(f.files.work,'process-abcd12');await mkdir(processDirectory);await writeFile(join(processDirectory,'work'),'temporary');
    await writeFile(join(f.files.work,'acquire-'+randomUUID()+'.part'),'partial');await writeFile(join(f.files.work,'protected-evidence.txt'),'keep');
    assert.equal(f.store.counts().bytes,bytes.length);f.store.recover();await f.files.initialize();await f.files.cleanWork();
    assert.equal(f.store.counts().bytes,0);assert.equal(f.store.read(f.access,asset.id).state,'failed');await assert.rejects(stat(await f.files.path(sha256)),{code:'ENOENT'});
    assert.deepEqual(await readdir(f.files.work),['protected-evidence.txt']);
  }finally{f.close();}
});

test('derived observations keep historical coverage after cache eviction but not after logical parent deletion',async()=>{
  const f=await mediaIoFixture();try{
    const parent=await f.files.ingest(f.access,'parent',f.source,{bytes:4,mime:'text/plain',stream:byteChunks(Buffer.from('raw!'))},signal());
    const child=await f.files.ingest(f.access,'child',f.source,{bytes:4,mime:'text/plain',stream:byteChunks(Buffer.from('part'))},signal(),{parent});
    const exposure=f.store.recordExposure(f.access,'read',{},f.source,{assets:[child],coverage:{acquiredBytes:4,processed:[],exposed:true,gaps:['synthetic receipt'],completeness:'partial'},text:'模拟观察',occurredAt:new Date().toISOString(),detail:{fixture:true}});
    f.store.beginEviction(child.sha256,Date.now());await f.files.cleanPending();assert.equal(f.store.exposureCurrent(exposure.id),true);
    f.store.deleteAsset(f.access,parent.id,parent.version);assert.equal(f.store.exposureCurrent(exposure.id),false);assert.throws(()=>f.store.read(f.access,child.id),/SOURCE_STALE/);
  }finally{f.close();}
});
