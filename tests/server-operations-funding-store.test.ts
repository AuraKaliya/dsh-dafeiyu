import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { link,readFile,readdir,unlink,writeFile } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FundingBindingSchema,FundingAuthorizationSchema,FundingPriceSchema,OperationsFundingStore,inspectOperationsFunding,operatorInitializeFunding,fundingBytesHash } from '@dafeiyu/server-runtime';
import { fundingFixture,synthetic,foreignBinding } from './server-operations-funding-fixture.js';

test('strict schema rejects hidden runtime hooks, unsafe funding paths, free defaults and unapproved synthetic production use',async()=>{
  const f=await fundingFixture();
  assert.equal(FundingBindingSchema.safeParse({...f.binding,clock:'untrusted-function'}).success,false);
  const {scopeHash,...oldBinding}=f.binding;assert.equal(FundingBindingSchema.safeParse({...oldBinding,hostHash:scopeHash}).success,false);
  assert.throws(()=>operatorInitializeFunding({...f.binding,scopeHash:'1'.repeat(64)},synthetic),/FUNDING_BINDING_MISMATCH/);
  for(const id of ['..','a:b','CON','a/b','a\\b'])assert.equal(FundingBindingSchema.safeParse({...f.binding,fundingId:id}).success,false);
  assert.equal(FundingAuthorizationSchema.safeParse({...f.authorization,maximumMicroCny:0}).success,false);
  assert.equal(FundingPriceSchema.safeParse({...f.price,output:0}).success,false);
  assert.throws(()=>operatorInitializeFunding(f.binding),/FUNDING_PURPOSE_DENIED/);assert.equal(existsSync(f.claim),false);
});

test('metadata-only inspect and existing-only open do not initialize a missing database or receipts',async()=>{
  const f=await fundingFixture(),before=await readdir(f.binding.receiptsRoot.path);
  const result=inspectOperationsFunding(f.binding,synthetic);assert.equal(result.ready,false);assert.equal(result.code,'FUNDING_INITIALIZATION_INCOMPLETE');
  assert.throws(()=>OperationsFundingStore.openExisting(f.binding,synthetic),/INITIALIZATION_INCOMPLETE/);
  assert.equal(existsSync(dirname(f.database)),false);assert.deepEqual(await readdir(f.binding.receiptsRoot.path),before);
});

test('explicit init succeeds once, stores only synthetic metadata and preserves bytes through readonly inspect',async()=>{
  const f=await fundingFixture(),initial=operatorInitializeFunding(f.binding,synthetic);assert.equal(initial.purpose,'synthetic-validation');assert.equal(initial.balance.maximumMicroCny,'100000');
  const before=fundingBytesHash(await readFile(f.database));assert.equal(inspectOperationsFunding(f.binding,synthetic).ready,true);
  assert.equal(fundingBytesHash(await readFile(f.database)),before);assert.throws(()=>operatorInitializeFunding(f.binding,synthetic),/FUNDING_ALREADY_INITIALIZED/);
  assert.throws(()=>operatorInitializeFunding(foreignBinding(f.binding),synthetic),/FUNDING_BINDING_MISMATCH/);
  const db=new DatabaseSync(f.database,{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM funding_reservations').get()?.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM funding_authorizations').get()?.n,1);}finally{db.close();}
});

test('lost database, missing completion receipt and an interrupted claim are never silently rebuilt',async()=>{
  const f=await fundingFixture();operatorInitializeFunding(f.binding,synthetic);const receipt=await readFile(f.complete);await unlink(f.database);
  assert.equal(inspectOperationsFunding(f.binding,synthetic).ready,false);assert.throws(()=>operatorInitializeFunding(f.binding,synthetic),/ALREADY_INITIALIZED/);assert.equal(existsSync(f.database),false);assert.deepEqual(await readFile(f.complete),receipt);
  const g=await fundingFixture();operatorInitializeFunding(g.binding,synthetic);await unlink(g.complete);assert.throws(()=>OperationsFundingStore.openExisting(g.binding,synthetic),/INITIALIZATION_INCOMPLETE/);assert.throws(()=>operatorInitializeFunding(g.binding,synthetic),/ALREADY_INITIALIZED/);
  const h=await fundingFixture();await writeFile(h.claim,'{"state":"initializing"}');assert.throws(()=>operatorInitializeFunding(h.binding,synthetic),/ALREADY_INITIALIZED/);assert.equal(existsSync(h.database),false);
});

test('price rotation, hardlinks and dropped immutable triggers are rejected without rewriting the original window',async()=>{
  const f=await fundingFixture();operatorInitializeFunding(f.binding,synthetic);const before=await readFile(f.database);await writeFile(f.binding.price.path,JSON.stringify({...f.price,output:1}));
  assert.equal(inspectOperationsFunding(f.binding,synthetic).code,'FUNDING_FILE_CHANGED');assert.deepEqual(await readFile(f.database),before);
  const g=await fundingFixture();operatorInitializeFunding(g.binding,synthetic);await link(g.database,join(g.root,'duplicate.sqlite'));assert.equal(inspectOperationsFunding(g.binding,synthetic).code,'FUNDING_PATH_INVALID');
  const h=await fundingFixture();operatorInitializeFunding(h.binding,synthetic);const db=new DatabaseSync(h.database);try{db.exec('DROP TRIGGER funding_authorizations_immutable');}finally{db.close();}
  assert.equal(inspectOperationsFunding(h.binding,synthetic).code,'FUNDING_SCHEMA_UNSUPPORTED');
});

test('explicit amendments append a finite chain, keep old bytes, and cannot change expiry, route, price or predecessor',async()=>{
  const f=await fundingFixture();operatorInitializeFunding(f.binding,synthetic);const store=OperationsFundingStore.openExisting(f.binding,synthetic);
  try{const initial=store.snapshot(),unused=await f.amendment(initial.authorizationHash);assert.equal(store.snapshot().balance.maximumMicroCny,initial.balance.maximumMicroCny);
    const db=new DatabaseSync(f.database,{readOnly:true});let original:unknown;try{original=db.prepare('SELECT body,hash FROM funding_authorizations WHERE seq=1').get();}finally{db.close();}
    const next=store.amend(unused);assert.equal(next.authorizationCount,2);assert.equal(next.balance.maximumMicroCny,'101000');assert.equal(next.expiresAt,initial.expiresAt);
    const reopened=new DatabaseSync(f.database,{readOnly:true});try{assert.deepEqual(reopened.prepare('SELECT body,hash FROM funding_authorizations WHERE seq=1').get(),original);}finally{reopened.close();}
    await assert.rejects(async()=>store.amend(await f.amendment(next.authorizationHash,{expiresAt:'2099-01-01T00:00:00.000Z'})),/AMENDMENT_MISMATCH/);
    await assert.rejects(async()=>store.amend(await f.amendment(next.authorizationHash,{routeHash:'1'.repeat(64)})),/AMENDMENT_MISMATCH/);
    await assert.rejects(async()=>store.amend(await f.amendment(next.authorizationHash,{priceHash:'2'.repeat(64)})),/AMENDMENT_MISMATCH/);
    await assert.rejects(async()=>store.amend(await f.amendment(next.authorizationHash,{scopeHash:'3'.repeat(64)})),/AMENDMENT_MISMATCH/);
    assert.throws(()=>store.amend(unused),/AMENDMENT_MISMATCH/);assert.equal(store.snapshot().authorizationCount,2);
  }finally{store.close();}
});

test('invalid receipt identity keeps only a bounded fingerprint and never persists its arbitrary payload',async()=>{
  const f=await fundingFixture();operatorInitializeFunding(f.binding,synthetic);f.clock.wall=Date.now();const store=OperationsFundingStore.openExisting(f.binding,synthetic),nonce=store.claimLease(f.clock.wall,()=> 'absent');
  try{store.activateLease(nonce,f.proof(),f.clock.wall);const call=f.call(),permit=store.reserve(nonce,call,f.clock.wall),bill=f.bill(call,permit);
    const receipt={...bill,usage:{...bill.usage!,inputTokens:-1,diagnostic:'FICTIONAL_PRIVATE_RECEIPT_SENTINEL'}};
    assert.deepEqual(store.settle(nonce,receipt,f.clock.wall),{unknown:true});assert.deepEqual(store.settle(nonce,receipt,f.clock.wall),{unknown:true});
    const db=new DatabaseSync(f.database,{readOnly:true});try{const body=String(db.prepare('SELECT body FROM funding_settlements').get()?.body);assert.ok(!body.includes('FICTIONAL_PRIVATE_RECEIPT_SENTINEL'));const parsed=JSON.parse(body);assert.match(parsed.requestReceiptHash,/^[a-f0-9]{64}$/);assert.notEqual(parsed.requestReceiptHash,parsed.normalizedReceiptHash);}finally{db.close();}
    store.releaseLease(nonce,f.clock.wall);
  }finally{store.close();}
});
