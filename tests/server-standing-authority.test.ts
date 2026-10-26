import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,symlink } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { join,resolve } from 'node:path';
import { ExternalTaskAuthorizationSchema,taskScopeKey } from '@dafeiyu/contracts';
import type { ExternalTaskAuthority } from '@dafeiyu/contracts';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { StandingAuthorityFile,StandingAuthoritySchema } from '../packages/server-bootstrap/lib/standing-authority.js';
import { testTempDir } from './test-temp.js';

const now=Date.parse('2026-10-26T12:00:00Z'),hash='a'.repeat(64);
async function fixture(){const root=await mkdtemp(join(testTempDir(),'standing-authority-')),configRoot=join(root,'configuration'),workRoot=join(root,'work'),file=join(configRoot,'standing.json');
  await mkdir(configRoot);await mkdir(workRoot);const record=StandingAuthoritySchema.parse({schemaVersion:1,id:'operator-standing',version:1,agentId:'test-fish',producers:['activity'],policyIds:['exploration'],
    actionIds:['dafeiyu_server_execute_autonomous'],purpose:'受信测试授权，仅用于本机虚构探索',effectiveAt:'2026-10-26T00:00:00Z',expiresAt:'2026-10-27T00:00:00Z',revoked:false,
    allowedWorkRoots:[workRoot],budgetAuthorizationId:'fixture-budget',maxExecutionMs:30000});
  const bytes=JSON.stringify(record);await writeFile(file,bytes);const config={path:file,configurationRoot:configRoot,id:record.id,version:record.version,hash:createHash('sha256').update(bytes).digest('hex')};
  const taskId=randomUUID(),runId=randomUUID(),authorization=ExternalTaskAuthorizationSchema.parse({schemaVersion:1,agentId:'test-fish',taskId,runId,operationId:randomUUID(),intentVersion:1,parentRunId:null,
    scope:{kind:'task',agentId:'test-fish',taskId,scopeKey:taskScopeKey('test-fish',taskId)},goal:'检查虚构目录',motivation:{kind:'self-exploration',basis:[]},policy:{producer:'activity',id:'exploration',hash},
    action:{owner:'server-executor',id:'dafeiyu_server_execute_autonomous',version:'1',pluginVersion:'0.1.0',effects:'external-write',hash},
    source:{kind:'activity-wake',origin:{kind:'wake',producerId:'activity',scheduleId:'fixture',scheduleVersion:1,occurrenceId:'fixture-1',dueAt:'2026-10-26T12:00:00Z'},
      anchor:{schemaVersion:1,id:randomUUID(),kind:'execution',runId,operationId:randomUUID(),scope:{kind:'task',agentId:'test-fish',taskId,scopeKey:taskScopeKey('test-fish',taskId)},intentVersion:1,hash},sourceHash:hash}});
  let live=true,time=now;const authority:ExternalTaskAuthority={authorization,hash:runtimeHash(authorization),guard:()=>{if(!live)throw new Error('CORE_GRANT_REVOKED');}};
  return {root,configRoot,workRoot,file,record,config,authority,reader:new StandingAuthorityFile(config,()=>time),revokeCore:()=>{live=false;},advance:()=>{time=Date.parse(record.expiresAt!);}};
}

test('an independently pinned standing file permits a matching live wake without creating an owner identity',async()=>{
  const h=await fixture(),grant=h.reader.authorize(h.authority,h.workRoot);grant.guard();assert.equal(grant.id,h.record.id);assert.equal(grant.budgetAuthorizationId,'fixture-budget');
  assert.equal(grant.maxExecutionMs,30000);assert.deepEqual(grant.allowedWorkRoots,[h.workRoot]);assert.equal(h.authority.authorization.source.kind,'activity-wake');
  assert.ok(Object.isFrozen(grant)&&Object.isFrozen(grant.allowedWorkRoots));h.revokeCore();assert.throws(()=>grant.guard(),/CORE_GRANT_REVOKED/);
});

test('wrong actor, producer, policy, action or work scope cannot borrow standing permission',async()=>{
  const h=await fixture();for(const change of [
    {policy:{...h.authority.authorization.policy,producer:'maintenance'}},
    {policy:{...h.authority.authorization.policy,id:'owner-task'}},
    {action:{...h.authority.authorization.action,id:'dafeiyu_server_execute_owner'}},
  ]){const authorization={...h.authority.authorization,...change};assert.throws(()=>h.reader.authorize({...h.authority,authorization,hash:runtimeHash(authorization)},h.workRoot),/STANDING_AUTHORITY_SCOPE_DENIED/);}
  assert.throws(()=>h.reader.authorize({...h.authority,authorization:{...h.authority.authorization,goal:'篡改冻结目标'}},h.workRoot),/EXTERNAL_AUTHORITY_CHANGED/);
  assert.throws(()=>h.reader.authorize(h.authority,h.root),/STANDING_AUTHORITY_SCOPE_DENIED/);
  const other=join(h.root,'other');await mkdir(other);const alias=join(h.workRoot,'outside');await symlink(other,alias,'junction');
  assert.throws(()=>h.reader.authorize(h.authority,alias),/STANDING_AUTHORITY_SCOPE_DENIED/);
});

test('revocation, expiry and a changed operator pin stop an existing permission',async()=>{
  const h=await fixture(),grant=h.reader.authorize(h.authority,h.workRoot);await writeFile(h.file,JSON.stringify({...h.record,revoked:true}));assert.throws(()=>grant.guard(),/STANDING_AUTHORITY_REVOKED/);
  await writeFile(h.file,JSON.stringify({...h.record,version:2}));assert.throws(()=>grant.guard(),/STANDING_AUTHORITY_CHANGED/);
  await writeFile(h.file,JSON.stringify(h.record));h.advance();assert.throws(()=>grant.guard(),/STANDING_AUTHORITY_EXPIRED/);
});

test('missing, redirected, malformed and secret-field config files fail closed without arbitrary imports',async()=>{
  const h=await fixture();assert.throws(()=>new StandingAuthorityFile({...h.config,path:join(h.configRoot,'missing.json')},()=>now).authorize(h.authority,h.workRoot),/STANDING_AUTHORITY_UNAVAILABLE/);
  const outside=join(h.root,'outside-config');await mkdir(outside);await writeFile(join(outside,'standing.json'),JSON.stringify(h.record));const alias=join(h.configRoot,'alias');await symlink(outside,alias,'junction');
  assert.throws(()=>new StandingAuthorityFile({...h.config,path:join(alias,'standing.json')},()=>now).authorize(h.authority,h.workRoot),/STANDING_AUTHORITY_UNAVAILABLE/);
  await writeFile(h.file,'{"schemaVersion":');assert.throws(()=>h.reader.authorize(h.authority,h.workRoot),/STANDING_AUTHORITY_INVALID/);
  await writeFile(h.file,JSON.stringify({...h.record,token:'fixture-secret'}));assert.throws(()=>h.reader.authorize(h.authority,h.workRoot),/STANDING_AUTHORITY_INVALID/);
  assert.equal(StandingAuthoritySchema.safeParse({...h.record,allowedWorkRoots:['relative']}).success,false);
  assert.equal(StandingAuthoritySchema.safeParse({...h.record,expiresAt:h.record.effectiveAt}).success,false);
});

test('a valid owner grant is distinct from autonomous standing permission',async()=>{
  const h=await fixture(),owner=ExternalTaskAuthorizationSchema.parse({...h.authority.authorization,motivation:{kind:'explicit-task',basis:[]},source:{kind:'owner-message',bindingId:'qq-tasks',inboundId:randomUUID(),
    messageId:'fixture-message',messageHash:hash,conversation:{channel:'qq',account:'fixture',kind:'private',id:'owner'},senderId:'owner',modality:'text',sourceHash:hash}});
  assert.throws(()=>h.reader.authorize({...h.authority,authorization:owner,hash:runtimeHash(owner)},resolve(h.workRoot)),/STANDING_AUTHORITY_SCOPE_DENIED/);
});
