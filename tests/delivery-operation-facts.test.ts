import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryOperationFact} from '../packages/core/lib/delivery-operation-facts.js';
import type {ActionOutcome} from '@dafeiyu/contracts';
const success=(data:ActionOutcome['data']):ActionOutcome=>({status:'succeeded',effects:'confirmed',completeness:'complete',data,sources:[],receipts:[]});
test('delivery evidence preserves selected sticker identity and actual destination without turning selection into sending',()=>{
  const selected=deliveryOperationFact({plugin:'qq-stickers',action:'qq_sticker_use',outcome:success({selected:1,sent:false,target:{channel:'qq',account:'100001',kind:'private',id:'200001'},sticker:{id:'chosen',name:'猫耳',version:1,collectedAt:'2026-11-08T14:00:00Z'},privateField:'must-not-appear'})});
  assert.ok(selected);const data=JSON.parse(selected.text).data;assert.equal(data.sticker.id,'chosen');assert.equal(data.sent,false);assert.ok(!selected.text.includes('must-not-appear'));
  const sent=deliveryOperationFact({plugin:'qq-stickers',action:'qq_sticker_send',outcome:success({state:'sent',stickerId:'chosen',receiptId:'123',target:{channel:'qq',account:'100001',kind:'group',id:'300001'}})});
  assert.equal(JSON.parse(sent!.text).data.target.kind,'group');assert.equal(JSON.parse(sent!.text).data.receiptId,'123');
});
test('waiting evidence retains the actual recorded blocker while marking it as an executor judgement',()=>{
  const fact=deliveryOperationFact({plugin:'memory-execution',action:'dafeiyu_task_object',outcome:success({id:'objection',category:'scope',blocking:true,reason:'缺少目标群发送入口',actions:['send']})});
  assert.ok(fact);assert.match(fact.text,/缺少目标群发送入口/);assert.match(fact.text,/不证明外部平台/);
});
