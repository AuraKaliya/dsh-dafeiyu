import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore} from '@dafeiyu/memory/store';
import {personaDigest} from '../packages/memory/lib/persona-digest.js';
import {SelfUnderstandingInputSchema,conversationKey} from '@dafeiyu/contracts';
import type {PersonaAccess,ExecutionScope,Conversation} from '@dafeiyu/contracts';

function fixture(originCurrent?:()=>boolean){const store=new MemoryStore(':memory:'),memory=store.autobiography('fixture',originCurrent),id=randomUUID();
  const scene:Conversation={channel:'simulator',account:'fixture',kind:'group',id:'one'},scope:ExecutionScope={kind:'conversation',agentId:'fixture',route:conversationKey('fixture',scene)};
  const access:PersonaAccess={view:{runId:id,taskId:null,scope,origin:{kind:'message',inboundId:randomUUID(),conversation:scene},signal:new AbortController().signal},producer:'fixture',operationId:randomUUID(),startedEventId:null,intentVersion:0,motivation:{kind:'explicit-task',basis:[]},inputs:[],admittedSources:[],guard:()=>{}};
  memory.begin({id,scope,origin:access.view.origin,goal:'受托阅读虚构材料',at:new Date().toISOString()});return {store,memory,id,access};}

test('the initial seed is memory-owned and a later template does not replace it',()=>{
  const f=fixture();try{const seed=f.memory.foundation(()=>({text:'fixture seed',version:'ignored',fileIdentity:'a'.repeat(64)}));
    assert.deepEqual(f.memory.foundation(()=>{throw new Error('Seed file must not be needed again');}),seed);}finally{f.store.close();}
});

test('facts, own interpretations and pending reflection remain separate across failed work',()=>{
  const f=fixture();try{const operation=randomUUID();f.memory.operation({episodeId:f.id,id:operation,action:'fixture_read',at:new Date().toISOString(),outcome:{status:'partial',effects:'none',completeness:'partial',data:{text:'只读到了第一部分'},sources:[],receipts:[]}});
    f.memory.settle(f.id,'failed');assert.equal(f.memory.pending(f.access.view.scope).length,1);
    assert.throws(()=>f.memory.reflect(f.access,{requestId:'bad',thought:'不应伪造经历',basis:[randomUUID()]}),/SOURCE_NOT_EXPOSED/);
    const reflected=f.memory.reflect(f.access,{requestId:'reflection',thought:'这次只读到一部分，还无法判断，但这种表达方式让我感兴趣。',uncertainty:'尚未读完',next:'以后有机会继续',basis:[operation]});
    assert.deepEqual(f.memory.reflect(f.access,{requestId:'reflection',thought:'这次只读到一部分，还无法判断，但这种表达方式让我感兴趣。',uncertainty:'尚未读完',next:'以后有机会继续',basis:[operation]}),reflected);
    assert.equal(f.memory.pending(f.access.view.scope).length,0);assert.equal(f.memory.read(f.access.view.scope,f.id).state,'failed');
    assert.deepEqual(f.memory.prepare().entries,[]);
  }finally{f.store.close();}
});

test('self-understanding requires retained reflection and a reviewed self-only view, including commissioned work',()=>{
  const f=fixture();try{const reflection=f.memory.reflect(f.access,{requestId:'reflection',thought:'受托比较材料时，我发现自己喜欢朴素的解释。'});
    const input=SelfUnderstandingInputSchema.parse({requestId:'self',expectedVersion:0,text:'我开始偏好朴素的解释。',applicability:'目前限于这类阅读',reflections:[reflection.id]});
    assert.throws(()=>f.memory.understand(f.access,input,'not-reviewed'),/SELF_VIEW_NOT_REVIEWED/);
    const basis=f.memory.reflections(f.access,input.reflections),saved=f.memory.understand(f.access,input,personaDigest({input,basis}));
    const entry=f.memory.prepare().entries[0]!;assert.equal(entry.memory.id,saved.id);assert.equal(entry.contentRef.kind,'memory');assert.ok(f.memory.validEntry(entry));
    assert.ok(!entry.item.text.includes('受托比较材料时'));assert.ok(entry.item.text.includes('目前限于'));
    f.memory.withdraw(f.access,saved.id,saved.version);assert.equal(f.memory.validEntry(entry),false);assert.equal(f.memory.prepare().entries.length,0);
  }finally{f.store.close();}
});

test('a conversation cannot read another conversation episode or reflection',()=>{
  const f=fixture();try{const reflection=f.memory.reflect(f.access,{requestId:'reflection',thought:'当前会话的私人看法'});
    const foreign={...f.access,view:{...f.access.view,scope:{kind:'conversation' as const,agentId:'fixture',route:conversationKey('fixture',{channel:'simulator',account:'fixture',kind:'group',id:'two'})}}};
    assert.throws(()=>f.memory.read(foreign.view.scope,f.id),/SCOPE_DENIED/);assert.throws(()=>f.memory.reflections(foreign,[reflection.id]),/SCOPE_DENIED/);
  }finally{f.store.close();}
});

test('recalled origins withdraw automatic experience indexes and explicit episode reads',()=>{
  let available=true;const f=fixture(()=>available);try{
    const scope=f.access.view.scope,item=f.memory.context(scope)[0]!;assert.ok(item);assert.equal(f.memory.contextCurrent(scope,item),true);
    available=false;assert.deepEqual(f.memory.pending(scope),[]);assert.equal(f.memory.contextCurrent(scope,item),false);
    assert.throws(()=>f.memory.read(scope,f.id),/SOURCE_STALE/);
    assert.throws(()=>f.memory.reflect(f.access,{requestId:'after-recall',thought:'不能重新引入已撤回的资料。'}),/SOURCE_STALE/);
  }finally{f.store.close();}
});

test('owner removal of a reflection invalidates its self-understanding and restoration preserves the original text',()=>{const f=fixture();try{const reflection=f.memory.reflect(f.access,{requestId:'basis',thought:'我更喜欢先核实再回答。'});const input=SelfUnderstandingInputSchema.parse({requestId:'self',expectedVersion:0,text:'我倾向核实来源。',applicability:'说明事实时',reflections:[reflection.id]}),basis=f.memory.reflections(f.access,input.reflections);f.memory.understand(f.access,input,personaDigest({input,basis}));const before=f.memory.prepare().entries[0]!;const command={id:reflection.id,expectedVersion:0,deleted:true,requestId:randomUUID(),reason:'主人管理依据'};f.memory.manageReflection(command);assert.deepEqual(f.memory.prepare().entries,[]);assert.equal(f.memory.validEntry(before),false);assert.throws(()=>f.memory.reflections(f.access,[reflection.id]),/SOURCE_STALE/);f.memory.manageReflection({...command,expectedVersion:1,deleted:false,requestId:randomUUID()});assert.equal(f.memory.prepare().entries[0]?.item.text,before.item.text);}finally{f.store.close();}});
