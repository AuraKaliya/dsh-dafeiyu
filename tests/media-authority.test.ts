import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { MediaAccess,ResourceProof,ExecutionContext } from '@dafeiyu/contracts';
import { executionHarness } from './execution-fixture.js';
import { testTempDir } from './test-temp.js';
import { call,textReply } from './harness.js';

test('media authority uses the actual capability grant and declared scene, and is revoked with its source or invocation',async()=>{
  const directory=await mkdtemp(join(testTempDir(),'media-authority-'));let h:Awaited<ReturnType<typeof executionHarness>>,access:MediaAccess|undefined,n=0,available=true;
  const scene={channel:'fixture',account:'local',kind:'local' as const,id:'allowed'},proof:ResourceProof={provider:'fixture',scene,key:'image',version:1,hash:'a'.repeat(64),roots:['fictional'],detail:{fixture:true}};
  h=await executionHarness(directory,()=>++n===1?call('fixture_media',{}):textReply('边界检查结束'),{id:'fixture',version:'1',resourceProofs:{current:p=>available&&p.provider==='fixture'&&p.hash===proof.hash,epoch:()=>String(available)},actions:[{
    id:'fixture_media',version:'1',description:'real scoped media authority fixture',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'read',execute:async(_i:unknown,c:ExecutionContext)=>{
      assert.throws(()=>h.core.mediaAccess({...c},'fixture',proof),/SCOPE_DENIED/);
      assert.throws(()=>h.core.mediaAccess(c,'fixture',{...proof,scene:{...scene,id:'foreign'}}),/RESOURCE_SCOPE_DENIED/);
      access=h.core.mediaAccess(c,'fixture',proof);access.guard();available=false;assert.throws(()=>access!.guard(),/MEDIA_SOURCE_STALE/);available=true;
      const modified=h.core.mediaAccess(c,'fixture',proof);modified.origin.roots.push('forged');assert.throws(()=>modified.guard(),/MEDIA_SOURCE_STALE/);
      return {status:'succeeded',effects:'none',completeness:'complete',data:{checked:true},sources:[],receipts:[]};
    }}]},true,{resources:[scene]});
  try{const accepted=h.port.submitTask({requestId:'media',title:'虚构媒体',goal:'检查实际读取边界',policyId:'test-policy'});await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');assert.ok(access);assert.throws(()=>access!.guard(),/SCOPE_DENIED/);}
  finally{await h.close();}
});
