import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {OneBot,oneBotDiagnostic} from '../../packages/channel-qq/lib/onebot.js';

test('OneBot response diagnostics retain the platform code and redact authorization without implying safe retry',async t=>{
  const token='fictional-onebot-credential-never-a-real-secret',server=createServer((_request,response)=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({status:'failed',retcode:1200,data:null,wording:'send private message rejected: result=10 authorization Bearer '+token}));});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise<void>(done=>server.close(()=>done())));const address=server.address();assert.ok(address&&typeof address!=='string');
  const client=new OneBot(`http://127.0.0.1:${address.port}/`,token,'12345678',1000);
  await assert.rejects(()=>client.call('send_private_msg',{user_id:87654321,message:'synthetic'}),error=>{const detail=oneBotDiagnostic(error);assert.equal(detail.kind,'onebot-call');if(detail.kind==='onebot-call'){assert.equal(detail.retcode,1200);assert.equal(detail.phase,'response');assert.equal(detail.fetchInvoked,true);assert.equal(detail.requestTimedOut,false);assert.match(detail.wording??'',/result=10/);assert.ok(!JSON.stringify(detail).includes(token));}return true;});
});

test('OneBot diagnostics distinguish caller cancellation before fetch from a dispatched request timeout',async t=>{
  let calls=0;const server=createServer(()=>{calls++;});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();return new Promise<void>(done=>server.close(()=>done()));});const address=server.address();assert.ok(address&&typeof address!=='string');
  const client=new OneBot(`http://127.0.0.1:${address.port}/`,'fixture-token','12345678',100),controller=new AbortController();controller.abort();
  await assert.rejects(()=>client.call('get_status',{},controller.signal),error=>{const detail=oneBotDiagnostic(error);assert.equal(detail.kind,'onebot-call');if(detail.kind==='onebot-call'){assert.equal(detail.phase,'before-fetch');assert.equal(detail.fetchInvoked,false);assert.equal(detail.callerAborted,true);}return true;});assert.equal(calls,0);
  await assert.rejects(()=>client.call('get_status',{}),error=>{const detail=oneBotDiagnostic(error);assert.equal(detail.kind,'onebot-call');if(detail.kind==='onebot-call'){assert.equal(detail.phase,'fetch');assert.equal(detail.fetchInvoked,true);assert.equal(detail.requestTimedOut,true);assert.equal(detail.callerAborted,false);}return true;});assert.equal(calls,1);
});
