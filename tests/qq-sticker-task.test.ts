import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { z } from 'zod';
import { QqStore,QQ_STICKER_ACTIONS } from '@dafeiyu/qq';
import { qqCapabilityFixture,scene,owner,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
const gif=Buffer.from('47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b','hex');
const metadata={name:'开心小鱼',description:'表达开心的虚构表情',tags:['开心']},origin={messageId:'1',sender:owner};
type H=Awaited<ReturnType<typeof qqCapabilityFixture>>;
function last<T>(request:GenerateOptions,schema:z.ZodType<T>):T{const items=outcomes(request).flatMap(outcome=>{const parsed=schema.safeParse(outcome.data);return parsed.success?[parsed.data]:[];});assert.ok(items.length);return items.at(-1)!;}
const storeAt=async(h:H)=>new QqStore(join(h.root,'qq/qq.sqlite'));
const encodedImages=(h:H)=>h.platform.sent.flatMap(raw=>z.object({message:z.array(z.object({type:z.string(),data:z.record(z.string(),z.unknown())}))}).parse(raw).message).filter(part=>part.type==='image').map(part=>Buffer.from(z.string().parse(part.data.file).slice(9),'base64'));
test('a QQ task can select a local sticker while its final text still passes through the persona session',async t=>{
  const h=await qqCapabilityFixture({media:true,stickers:true,tasks:true,deliverResults:true,extraTaskActions:[...QQ_STICKER_ACTIONS],turnTimeoutMs:30000});t.after(h.close);const store=await storeAt(h);try{store.stickers.collect(scene,origin,metadata,gif,'image/gif');}finally{store.close();}
  let chat=0,work=0;h.setResponse(request=>{const session=String(request.sessionId);if(session.startsWith('dafeiyu-delivery-v3-'))return textReply('给你送来这张表情。');if(session.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":true,"issues":[]}');
    if(session.startsWith('dafeiyu-task-')){if(++work===1)return call('qq_sticker_list',{});if(work===2)return call('qq_sticker_use',{id:last(request,z.object({stickers:z.array(z.object({id:z.uuid()}))})).stickers[0]!.id,requestId:'task-sticker',expectedVersion:0});return textReply('已准备本地表情作为这次回复。');}
    return ++chat===1?call('qq_task_submit',{kind:'explicit-task',requestId:'sticker-task'}):textReply('已受理');});
  await h.message('任务：给我发一个合适的本地表情',{trigger:true,id:'9404'});assert.deepEqual(encodedImages(h),[gif]);assert.ok(h.platform.sent.some(part=>JSON.stringify(part).includes('给你送来这张表情。')));
});
