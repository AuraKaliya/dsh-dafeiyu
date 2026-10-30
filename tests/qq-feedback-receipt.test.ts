import test from 'node:test';
import assert from 'node:assert/strict';
import {QqChannel} from '../packages/channel-qq/lib/index.js';

const receipt=(progress:unknown)=>{
  const channel=Object.create(QqChannel.prototype) as {deliveryStatus:(id:string)=>unknown;feedbackReceipt:(input:{feedbackId:string;route:string;deliveryId:string})=>{state:string;receiptId?:string}};
  channel.deliveryStatus=()=>progress;
  return channel.feedbackReceipt({feedbackId:'00000000-0000-4000-8000-000000000001',route:'route',deliveryId:'feedback:one:1'});
};

test('QQ receipt lookup maps delivery ledger states without inventing a send',()=>{
  assert.deepEqual(receipt({state:'ready',segments:[]}),{state:'not-sent'});
  assert.deepEqual(receipt({state:'sent',segments:[{state:'sent',receipt:'42'}]}),{state:'sent',receiptId:'42'});
  assert.deepEqual(receipt({state:'uncertain',segments:[{state:'unknown',receipt:null}]}),{state:'unknown'});
  assert.deepEqual(receipt({state:'partial',segments:[{state:'sent',receipt:'42'},{state:'pending',receipt:null}]}),{state:'unknown'});
  assert.deepEqual(receipt(null),{state:'unknown'});
});
