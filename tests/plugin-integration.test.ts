import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleHostPlugins } from '@dafeiyu/host';
import { BiliOwnerStore,BiliOwnerPluginConfigSchema,biliOwnerScene,biliOwnerConsumerKey } from '@dafeiyu/bilibili/channel';
import { GrowthService } from '@dafeiyu/memory';
import { testTempDir } from './test-temp.js';

test('one public platform row expands to stable internal interfaces and rejects duplicate ownership',()=>{
  const raw=JSON.parse(readFileSync('profiles/host.test.json','utf8'));
  raw.plugins=raw.plugins.filter((p:{id:string})=>p.id!=='memory-growth');
  raw.plugins.push({id:'memory-growth'},{id:'bilibili',config:{capabilities:{},channel:{accountUid:'20000001',ownerUid:'20000002',tasks:{enabled:false}}}});
  const normalized=assembleHostPlugins(raw);
  assert.equal(normalized.plugins.filter(p=>p.id==='memory').length,1);
  assert.deepEqual(normalized.plugins.slice(-2).map(p=>p.id),['bilibili','channel-bili-owner']);
  assert.equal(normalized.plugins.at(-1)!.config.ownerUid,'20000002');
  assert.throws(()=>assembleHostPlugins({...raw,plugins:[...raw.plugins,{id:'bilibili',config:{channel:{accountUid:'20000001',ownerUid:'20000002'}}}]}));
  assert.throws(()=>assembleHostPlugins({...raw,plugins:[...raw.plugins,{id:'memory'}]}));
});

test('two independently configured Bili identities cannot read, receive or retarget each other',()=>{
  const root=mkdtempSync(join(testTempDir(),'platform-identities-'));
  const identity={agentId:'fixture-fish',profileId:'fixture',accountUid:'20000001',ownerUid:'20000002'};
  const other={...identity,accountUid:'30000001',ownerUid:'30000002'};
  for(const value of [{},{accountUid:identity.accountUid},{ownerUid:identity.ownerUid},{accountUid:identity.accountUid,ownerUid:identity.accountUid}])assert.throws(()=>BiliOwnerPluginConfigSchema.parse(value));
  assert.notEqual(biliOwnerConsumerKey(identity),biliOwnerConsumerKey(other));
  assert.notDeepEqual(biliOwnerScene(identity),biliOwnerScene(other));
  const file=join(root,'bili-owner.sqlite'),store=new BiliOwnerStore(file,identity,true);
  try{
    store.initializeFresh({requestId:'fresh',since:0,cutoverHash:'a'.repeat(64)});
    const page={accountUid:identity.accountUid,ownerUid:identity.ownerUid,loggedIn:true,bindingStamp:'b'.repeat(64),hasMore:false,nextBeforeSeqno:null,messages:[{id:'1',seqno:'1',senderUid:identity.ownerUid,receiverUid:identity.accountUid,type:1,timestamp:100,text:'synthetic'}]};
    assert.throws(()=>store.acceptPage({...page,accountUid:other.accountUid,ownerUid:other.ownerUid,messages:[]},store.cursor().version),/ACCOUNT_MISMATCH/);
    store.acceptPage(page,store.cursor().version);assert.equal(store.pending().length,1);
    assert.throws(()=>new BiliOwnerStore(file,other),/IDENTITY_MISMATCH/);
  }finally{store.close();}
  const reopened=new BiliOwnerStore(file,identity);try{assert.equal(reopened.pending().length,1);}finally{reopened.close();}
});
