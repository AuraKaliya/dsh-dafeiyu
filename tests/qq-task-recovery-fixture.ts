import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { NativeDeliveryStore } from '../packages/core/lib/native-delivery-store.js';
import { qqCapabilityFixture } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
const root=process.argv[2]!,mode=process.argv[3]!;
if(mode==='ready'){const original=NativeDeliveryStore.prototype.approve;NativeDeliveryStore.prototype.approve=function(...args){original.apply(this,args);process.exit(73);};}
if(mode==='sending'){const original=NativeDeliveryStore.prototype.sending;NativeDeliveryStore.prototype.sending=function(...args){original.apply(this,args);process.exit(74);};}
if(mode==='rendering'){const original=NativeDeliveryStore.prototype.start;NativeDeliveryStore.prototype.start=function(...args){original.apply(this,args);process.exit(75);};}
const h=await qqCapabilityFixture({tasks:true,deliverResults:true,existingRoot:root});
try{if(mode==='resume'){
    await h.core.whenIdle();const db=new DatabaseSync(join(root,'core','runtime.sqlite'),{readOnly:true});let id:string;try{id=String(db.prepare('SELECT run_id FROM native_deliveries').get()?.run_id);}finally{db.close();}
    console.log(JSON.stringify({state:h.core.messageTaskDeliveryStatus(id)?.state,modelCalls:h.adapter.requests.length,sends:h.platform.sent.length,realPlatform:false,realModel:false,serverAccess:false}));
  }else{let chat=0;h.setResponse(request=>String(request.sessionId).startsWith('dafeiyu-delivery-v3-')?textReply('已核对的虚构人格结果'):String(request.sessionId).startsWith('memory-expression-verify-delivery-')?textReply('{"faithful":true,"issues":[]}'):String(request.sessionId).startsWith('dafeiyu-task-')?textReply('虚构执行结果'):++chat===1?call('qq_task_submit',{requestId:'source'}):textReply('已受理'));
    await h.message('任务：完成虚构恢复检查',{trigger:true});assert.fail('The selected crash point was not reached');}
}finally{await h.close();}
