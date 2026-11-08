import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryVerificationBody,checkDeliveryVerification} from '../packages/memory/lib/delivery-verification.js';

const input={question:'为什么群消息看不到？',evidence:[{id:'cache',kind:'reported' as const,text:'本次可读缓存没有B群记录；无法证明消息在上游是否发生或投递。'},{id:'code',kind:'reported' as const,text:'remember(message); if (!mentioned) return; reply(message);'}]};
const body=deliveryVerificationBody(input,'本次缓存没有B群记录。只有提及才保存消息。');
const okay={passageId:'P1',status:'supported',evidenceIds:['cache'],issue:null};

test('final verification cannot approve an omitted passage or an unknown source',()=>{
  assert.throws(()=>checkDeliveryVerification({faithful:true,issues:[]},body),/INVALID_RESULT/);
  assert.throws(()=>checkDeliveryVerification({checks:[okay]},body),/INVALID_RESULT/);
  assert.throws(()=>checkDeliveryVerification({checks:[okay,okay]},body),/INVALID_RESULT/);
  assert.throws(()=>checkDeliveryVerification({checks:[okay,{...okay,passageId:'P2',evidenceIds:['invented']}]},body),/INVALID_RESULT/);
  assert.throws(()=>checkDeliveryVerification({checks:[okay,{...okay,passageId:'P2',evidenceIds:[]}]},body),/INVALID_RESULT/);
  assert.throws(()=>checkDeliveryVerification({checks:[okay,{...okay,passageId:'P2',evidenceIds:['code','code']}]},body),/INVALID_RESULT/);
});

test('one contradicted passage prevents sending and retains precise repair feedback',()=>{
  assert.throws(()=>checkDeliveryVerification({checks:[okay,{passageId:'P2',status:'contradicted',evidenceIds:['code'],issue:'保存发生在提及判断之前；条件只控制回复。'}]},body),error=>{
    assert.ok(error instanceof Error);assert.equal(error.message,'delivery_unfaithful');assert.deepEqual(error.cause,{kind:'delivery-fidelity',issues:['P2 原句「只有提及才保存消息。」：保存发生在提及判断之前；条件只控制回复。']});return true;
  });
  checkDeliveryVerification({checks:[okay]},deliveryVerificationBody(input,'本次缓存没有B群记录。'));
});

test('verification unfolds evidence envelopes without promoting inferences or changing identifiers',()=>{
  const id='90071992547409931234',data={id,text:'本次观察：0条，不代表从未收到。'};
  const result=deliveryVerificationBody({question:'fixture',evidence:[{id:'B0',kind:'inference',text:JSON.stringify({kind:'evidence-bundle',items:[{id:'R',text:JSON.stringify({nested:JSON.stringify(data)})}]})}]},'只是推测。');
  assert.deepEqual(result.approvedEvidence,[{id:'R',kind:'inference',content:{nested:data}}]);
  assert.equal(result.candidatePassages[0]?.text,'只是推测。');
  const unsafe='{"id":90071992547409931234}';
  assert.equal(deliveryVerificationBody({question:'fixture',evidence:[{id:'s',text:unsafe}]},'fixture').approvedEvidence[0]?.content,unsafe);
});

test('every passage including scope qualifiers receives its own check; punctuation and multiline replies are preserved',()=>{
  const result=deliveryVerificationBody(input,'已读6帧。未听音轨！\n这是采样，不是全片。');
  assert.deepEqual(result.candidatePassages.map(p=>p.text),['已读6帧。','未听音轨！','这是采样，不是全片。']);
  assert.throws(()=>checkDeliveryVerification({checks:result.candidatePassages.map(p=>({...okay,passageId:p.id,status:'non-factual'}))},result),/INVALID_RESULT/);
});

test('an explicitly assessed evidence limitation does not require an absent external source',()=>{
  const limited=deliveryVerificationBody({question:'能确认收到吗？',evidence:[{id:'old',kind:'inference',text:'旧机器人回答提到B群，但没有独立读取结果。'}]},'当前没有可独立核对的材料，无法确认。');
  checkDeliveryVerification({checks:[{passageId:'P1',status:'scope-limited',evidenceIds:[],issue:null}]},limited);
  checkDeliveryVerification({checks:[{passageId:'P1',status:'scope-limited',evidenceIds:['old'],issue:null}]},limited);
  assert.throws(()=>checkDeliveryVerification({checks:[{passageId:'P1',status:'scope-limited',evidenceIds:['missing'],issue:null}]},limited),/INVALID_RESULT/);
  assert.throws(()=>checkDeliveryVerification({checks:[{passageId:'P1',status:'unsupported',evidenceIds:[],issue:'仍含无依据的外部结论'}]},limited),/delivery_unfaithful/);
});
