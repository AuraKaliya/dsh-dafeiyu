import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ManagementRequestSchema,API_VERSION} from '@dafeiyu/contracts';
import {ManagementSettings} from '../packages/plugin/lib/management-settings.js';
import {managementModules} from '../packages/plugin/lib/management-catalog.js';
import {promptCatalog} from '../packages/plugin/lib/prompt-catalog.js';
import {QqReplyDelaySchema,qqReplyDelayMs} from '@dafeiyu/qq';
import {usageTokens,withRunUsage,reportExternalUsage} from '../packages/core/lib/usage.js';
import {testTempDir} from './test-temp.js';

test('management has one strict protocol and source-owned single-purpose groups',()=>{
  assert.ok(ManagementRequestSchema.safeParse({apiVersion:API_VERSION,kind:'describe'}).success);
  assert.equal(ManagementRequestSchema.safeParse({apiVersion:API_VERSION,kind:'describe',owner:true}).success,false);
  assert.equal(ManagementRequestSchema.safeParse({apiVersion:API_VERSION+1,kind:'describe'}).success,false);
  const paths=managementModules.flatMap(module=>module.sections.flatMap(section=>section.fields.map(field=>field.path)));
  assert.equal(new Set(paths).size,paths.length);assert.ok(managementModules.some(module=>module.id==='bilibili'));
  assert.ok(promptCatalog.some(prompt=>prompt.id==='dafeiyu-execution-rules'&&prompt.text.includes('上下文快照')));
});
test('configuration edits use field ownership, revisions and the sole installation file',()=>{
  const root=join(testTempDir(),randomUUID());mkdirSync(root);const file=join(root,'settings.json'),config=JSON.parse(readFileSync('packages/plugin/examples/dafeiyu.config.json','utf8'));config.model={model:'fixture',credentialStore:'fixture-credentials.json'};config.qq={...config.qq,botId:'123456',ownerId:'654321',tokenFile:'fixture-token.txt'};writeFileSync(file,JSON.stringify(config));
  const store=new ManagementSettings(file),before=store.describe();assert.ok(!Object.keys(before.values).some(key=>/inlineTransport/.test(key)));
  assert.throws(()=>store.apply(before.revision,[{module:'qq',values:{'model.model':'wrong-owner'}}]),/FIELD_INVALID/);
  assert.throws(()=>store.apply(before.revision,[{module:'qq',values:{'qq.replyDelay.minimumMs':20000}}]),/INSTALL_CONFIGURATION_REQUIRED/);
  const saved=store.apply(before.revision,[{module:'qq',values:{'qq.replyDelay.minimumMs':1000}}]);assert.notEqual(saved.revision,before.revision);
  assert.equal(store.describe().values['qq.replyDelay.minimumMs'],1000);assert.throws(()=>store.apply(before.revision,[{module:'qq',values:{'qq.ownerId':'123456'}}]),/REVISION_CONFLICT/);
});
test('reply delay uses Unicode characters and validated configurable bounds',()=>{
  const config=QqReplyDelaySchema.parse({minimumMs:100,perCharacterMs:50,maximumMs:250});assert.equal(qqReplyDelayMs('鱼🐟',config),200);assert.equal(qqReplyDelayMs('大肥鱼🐟',config),250);assert.equal(qqReplyDelayMs('鱼',{...config,enabled:false}),0);assert.equal(QqReplyDelaySchema.safeParse({minimumMs:300,maximumMs:200}).success,false);
});
test('usage includes disjoint cache input once and keeps unknown totals unknown',async()=>{
  assert.equal(usageTokens({inputTokens:2,outputTokens:4,cacheReadTokens:3,reasoningTokens:2,totalTokens:9}),9);
  assert.equal(usageTokens({inputTokens:2,outputTokens:4,totalTokens:1}),null);
  const receipts:unknown[]=[];await withRunUsage(receipt=>receipts.push(receipt),async()=>reportExternalUsage({id:randomUUID(),tokens:12,durationMs:1}));assert.equal(receipts.length,1);
  reportExternalUsage({id:randomUUID(),tokens:99,durationMs:1});assert.equal(receipts.length,1);
});
