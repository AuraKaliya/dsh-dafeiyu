import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {API_VERSION,ContextAssemblySchema,HostConfigSchema} from '@dafeiyu/contracts';
import type {Extension} from '@dafeiyu/contracts';
import {CapabilityRegistry} from '../packages/core/lib/capability-registry.js';
import {assembleHostPlugins} from '@dafeiyu/host';

test('one current registration contract validates data and leaves no partial registration',()=>{
  const registry=new CapabilityRegistry(),valid:Extension={id:'fixture',version:'1',agentId:'fixture',protocolVersion:API_VERSION,actions:[{id:'fixture_read',version:'1',scope:'conversation',effects:'read',description:'fixture',inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async()=>({status:'succeeded',effects:'none',completeness:'complete',data:null,sources:[],receipts:[]})}]};
  for(const malformed of [{...valid,protocolVersion:API_VERSION+1},{...valid,extra:true},{...valid,actions:[{...valid.actions![0],unexpected:true}]}]){
    assert.throws(()=>registry.register('fixture',malformed as Extension));assert.equal(registry.ids().length,0);
  }
  const handle=registry.register('fixture',valid);assert.equal(registry.actions()[0]?.scope,'conversation');handle.dispose();assert.equal(registry.actions().length,0);
});

test('public configuration has one platform form and context assembly has no format selector',()=>{
  const config=JSON.parse(readFileSync('profiles/host.test.json','utf8'));assert.equal(HostConfigSchema.safeParse(config).success,true);
  assert.ok(assembleHostPlugins(config).plugins.some(plugin=>plugin.id==='memory'));
  assert.equal(ContextAssemblySchema.safeParse({mode:'anything'}).success,false);
  assert.equal(HostConfigSchema.safeParse({...config,plugins:[{id:'unknown-module',config:{}}]}).success,false);
  assert.throws(()=>assembleHostPlugins({...config,plugins:[...config.plugins,{id:'bilibili',config:{arbitrary:true}}]}));
});
