import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile,writeFile,symlink,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILI_OWNER_ACCOUNT,BILI_OWNER_UID,biliOwnerTextHash,createBiliOwnerProductionPorts } from '@dafeiyu/channel-bili-owner';
import { loadBiliOwnerProductionBinding,BiliOwnerProductionConfigSchema } from '../packages/channel-bili-owner/lib/production-config.js';
import { acquireBiliOwnerConsumerLease } from '../packages/channel-bili-owner/lib/production-lease.js';
import { productionFixture,NAV,READ,SEND,noNetwork,nav,json } from './bili-owner-production-fixture.js';

const signal=()=>AbortSignal.timeout(5000),guard=()=>{};
const sent=(text='虚构私信')=>({requestId:'bili1_fictional_request',text,wireHash:biliOwnerTextHash(text)});
// The machine-wide pipe is intentionally shared by all profiles. Keep every production acquisition serial in this one file.
test('production pinning rejects path aliases and changed source before any default fetch or credential read',{concurrency:false},async()=>{
  const f=await productionFixture(),original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('DEFAULT_FETCH_MUST_NOT_RUN');};
  try{assert.throws(()=>BiliOwnerProductionConfigSchema.parse({...f.config,installationRoot:'\\\\server\\share'}));assert.throws(()=>loadBiliOwnerProductionBinding({...f.config,manifestPath:f.publicPath}),/BILI_OWNER_MANIFEST_PATH/);
    await rename(f.credentialPath,join(f.root,'unopened-fictional-credential.json'));
    const binding=loadBiliOwnerProductionBinding(f.config);assert.equal(binding.manifest.generation,7);assert.equal(calls,0);
    await writeFile(f.authPath,(await readFile(f.authPath,'utf8'))+'\n');assert.throws(()=>loadBiliOwnerProductionBinding(f.config),/BILI_OWNER_AUTH_CHANGED/);assert.equal(calls,0);
    const alias=join(f.root,'linked-configuration');await symlink(join(f.root,'配置文件'),alias,'junction');assert.throws(()=>loadBiliOwnerProductionBinding({...f.config,manifestPath:join(alias,'bili-owner-channel.json')}),/BILI_OWNER_MANIFEST_PATH/);
  }finally{globalThis.fetch=original;}
});

test('the actual pinned Auth preserves numeric IDs before JSON parsing and reads only the fixed owner page',{concurrency:false},async()=>{
  const f=await productionFixture(),requests:string[]=[];const ports=await createBiliOwnerProductionPorts(f.config,{fetch:async(input,init)=>{const url=new URL(String(input));requests.push(url.origin+url.pathname);
    assert.equal(init?.redirect,'error');assert.ok(init?.signal);if(url.origin+url.pathname===NAV)return json(nav());assert.equal(url.origin+url.pathname,READ);assert.equal(init?.method,'GET');assert.equal(url.searchParams.get('talker_id'),BILI_OWNER_UID);assert.equal(url.searchParams.get('size'),'2');assert.equal(url.searchParams.get('begin_seqno'),'9007199254740993999');
    return new Response('{"code":0,"data":{"has_more":1,"messages":[{"msg_key":9007199254740993123,"msg_seqno":9007199254740993123,"sender_uid":13461350,"receiver_id":170759822,"receiver_type":1,"msg_type":1,"timestamp":1793000000,"content":"{\\"content\\":\\"虚构文字\\"}"}]}}');}});
  try{const identity=await ports.transport.verify(signal(),guard);assert.equal(identity.accountUid,BILI_OWNER_ACCOUNT);const page=await ports.transport.readOwnerPage({limit:2,beforeSeqno:'9007199254740993999'},signal(),guard);
    assert.equal(page.messages[0]?.id,'9007199254740993123');assert.equal(page.messages[0]?.seqno,'9007199254740993123');assert.equal(page.messages[0]?.text,'虚构文字');assert.equal(page.nextBeforeSeqno,'9007199254740993123');assert.equal(page.bindingStamp,identity.bindingStamp);assert.deepEqual(requests,[NAV,NAV,READ]);
  }finally{await ports.transport.close?.();await ports.lease.release();}
});

test('fixed DM sends retain the real receipt and reject extra targets, excess text and changed hashes before POST',{concurrency:false},async()=>{
  const f=await productionFixture();let posts=0;const ports=await createBiliOwnerProductionPorts(f.config,{fetch:async(input,init)=>{const url=new URL(String(input));if(url.origin+url.pathname===NAV)return json(nav());assert.equal(url.origin+url.pathname,SEND);assert.equal(init?.method,'POST');const body=init!.body;assert.ok(body instanceof URLSearchParams);
    assert.equal(body.get('msg[receiver_id]'),BILI_OWNER_UID);assert.equal(body.get('msg[sender_uid]'),BILI_OWNER_ACCOUNT);assert.equal(body.get('msg[content]'),JSON.stringify({content:'🐟'.repeat(1000)}));posts++;
    return new Response('{"code":0,"data":{"msg_key":9007199254740993555}}');}});
  try{const result=await ports.transport.sendOwnerText(sent('🐟'.repeat(1000)),signal(),guard);assert.equal(result.status,'sent');if(result.status==='sent')assert.equal(result.receiptId,'9007199254740993555');assert.equal(posts,1);
    for(const value of [sent('🐟'.repeat(1001)),sent('\ud800'),{...sent(),wireHash:'a'.repeat(64)},{...sent(),receiverUid:'111111'}])assert.equal((await ports.transport.sendOwnerText(value,signal(),guard)).status,'not-dispatched');assert.equal(posts,1);
  }finally{await ports.transport.close?.();await ports.lease.release();}
});

test('any uncertain response after POST remains unknown and never triggers an internal retry',{concurrency:false},async()=>{
  const f=await productionFixture();let posts=0,mode:'network'|'risk'|'missing'='network';const ports=await createBiliOwnerProductionPorts(f.config,{fetch:async input=>{if(String(input).startsWith(NAV))return json(nav());posts++;if(mode==='network')throw new Error('FICTIONAL_PRIVATE_DETAIL');if(mode==='risk')return json({code:-412,message:'FICTIONAL_PRIVATE_DETAIL'},412);return json({code:0,data:{}});}});
  try{for(const kind of ['network','risk','missing'] as const){mode=kind;const value=await ports.transport.sendOwnerText({...sent(),requestId:'fixture_'+kind},signal(),guard);assert.equal(value.status,'unknown');assert.ok(!JSON.stringify(value).includes('PRIVATE_DETAIL'));}assert.equal(posts,3);
  }finally{await ports.transport.close?.();await ports.lease.release();}
});

test('live authorization loss before POST is unsent while an abort after dispatch stays unknown',{concurrency:false},async()=>{
  const f=await productionFixture();let authorized=true,posts=0,denyInNav=true;const abort=new AbortController();const ports=await createBiliOwnerProductionPorts(f.config,{fetch:async input=>{if(String(input).startsWith(NAV)){if(denyInNav)authorized=false;return json(nav());}posts++;abort.abort(new Error('FICTIONAL_PRIVATE_REASON'));throw new Error('FICTIONAL_PRIVATE_DETAIL');}});
  try{const check=()=>{if(!authorized)throw new Error('BILI_OWNER_TEST_REVOKED');};const blocked=await ports.transport.sendOwnerText(sent(),signal(),check);assert.deepEqual(blocked,{status:'not-dispatched',code:'BILI_OWNER_TEST_REVOKED'});assert.equal(posts,0);
    authorized=true;denyInNav=false;const unknown=await ports.transport.sendOwnerText(sent(),abort.signal,check);assert.equal(unknown.status,'unknown');assert.equal(posts,1);assert.ok(!JSON.stringify(unknown).includes('PRIVATE'));
  }finally{await ports.transport.close?.();await ports.lease.release();}
});

test('wrong local or authenticated remote identity is rejected without leaking response or credential data',{concurrency:false},async()=>{
  const f=await productionFixture();let calls=0,remote='123456';const ports=await createBiliOwnerProductionPorts(f.config,{fetch:async()=>{calls++;return json(nav(remote));}});
  try{await assert.rejects(()=>ports.transport.verify(signal(),guard),/^Error: BILI_OWNER_ACCOUNT_MISMATCH$/);assert.equal(calls,1);await f.credentials('123456');
    await assert.rejects(()=>ports.transport.verify(signal(),guard),/^Error: BILI_OWNER_ACCOUNT_MISMATCH$/);assert.equal(calls,1);remote=BILI_OWNER_ACCOUNT;await f.credentials();
    assert.equal((await ports.transport.verify(signal(),guard)).accountUid,BILI_OWNER_ACCOUNT);assert.equal(calls,2);
  }finally{await ports.transport.close?.();await ports.lease.release();}
});

test('cookie refresh and public configuration repinning preserve stable identity; only an explicit generation changes it',{concurrency:false},async()=>{
  const f=await productionFixture();let ports=await createBiliOwnerProductionPorts(f.config,{fetch:async()=>json(nav())});const identity=ports.transport.identityHash;
  try{const first=await ports.transport.verify(signal(),guard);await f.credentials(BILI_OWNER_ACCOUNT,'FICTIONAL_REFRESHED_SESSION');assert.equal((await ports.transport.verify(signal(),guard)).bindingStamp,first.bindingStamp);
    await writeFile(f.publicPath,JSON.stringify({accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID,privateMessages:{pollMs:45000},publicInteraction:{comments:false}}));assert.throws(()=>ports.transport.guard(),/BILI_OWNER_CONFIG_CHANGED/);
  }finally{await ports.transport.close?.();await ports.lease.release();}
  await f.repin();ports=await createBiliOwnerProductionPorts(f.config,{fetch:noNetwork});try{assert.equal(ports.transport.identityHash,identity);assert.equal(ports.lease.epoch,7);}finally{await ports.transport.close?.();await ports.lease.release();}
  await f.repin(8);ports=await createBiliOwnerProductionPorts(f.config,{fetch:noNetwork});try{assert.notEqual(ports.transport.identityHash,identity);assert.equal(ports.lease.epoch,8);}finally{await ports.transport.close?.();await ports.lease.release();}
});

test('the fixed pipe rejects another profile and is released by both graceful close and real child-process exit',{concurrency:false},async()=>{
  const first=await productionFixture(),other=await productionFixture(),binding=loadBiliOwnerProductionBinding(first.config),a=await acquireBiliOwnerConsumerLease(binding);
  try{await assert.rejects(()=>acquireBiliOwnerConsumerLease(loadBiliOwnerProductionBinding(other.config)),/BILI_OWNER_CONSUMER_BUSY/);assert.equal(a.epoch,7);a.guard();}finally{await a.release();await a.release();}
  assert.throws(()=>a.guard(),/BILI_OWNER_LEASE_REVOKED/);
  const invalidDependencies={fetch:noNetwork,actor:'not-an-authority'};await assert.rejects(()=>createBiliOwnerProductionPorts(first.config,invalidDependencies),/BILI_OWNER_PRODUCTION_DEPENDENCY/);
  const child=spawn(process.execPath,[fileURLToPath(new URL('./bili-owner-production-lease-child.js',import.meta.url)),JSON.stringify(first.config)],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});child.stdout?.resume();child.stderr?.resume();const exited=once(child,'exit');
  try{const [ready]=await once(child,'message',{signal:AbortSignal.timeout(10000)});assert.deepEqual(ready,{ready:true,epoch:7});await assert.rejects(()=>acquireBiliOwnerConsumerLease(loadBiliOwnerProductionBinding(other.config)),/BILI_OWNER_CONSUMER_BUSY/);child.kill();await exited;
    const recovered=await acquireBiliOwnerConsumerLease(loadBiliOwnerProductionBinding(first.config));try{assert.equal(recovered.epoch,7);recovered.guard();}finally{await recovered.release();}
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}}
});

test('response size and depth failures are bounded, and a credential path alias is refused before network',{concurrency:false},async()=>{
  const f=await productionFixture();let calls=0,large=true;const ports=await createBiliOwnerProductionPorts(f.config,{fetch:async()=>{calls++;return large?new Response('x',{headers:{'content-length':'1048577'}}):new Response('['.repeat(33)+'0'+']'.repeat(33));}});
  try{await assert.rejects(()=>ports.transport.verify(signal(),guard),/BILI_OWNER_RESPONSE_LIMIT/);large=false;await assert.rejects(()=>ports.transport.verify(signal(),guard),/BILI_OWNER_RESPONSE_LIMIT/);assert.equal(calls,2);
    const moved=join(f.root,'fictional-credential.json');await rename(f.credentialPath,moved);await symlink(moved,f.credentialPath,'file');await assert.rejects(()=>ports.transport.verify(signal(),guard),/BILI_OWNER_LOGIN_REQUIRED/);assert.equal(calls,2);
  }finally{await ports.transport.close?.();await ports.lease.release();}
});
