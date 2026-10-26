import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DeepSeekAdapter,resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import { createUserMessage,ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { REAL_CONNECTION_HEADERS } from '../../scripts/evaluation/real-runtime.ts';
import { z } from 'zod';
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
if(!process.env.DAFEIYU_TEST_RUN)throw new Error('MANAGED_TEST_RUN_REQUIRED');

test('installed DeepSeek transport uses distinct HTTP connections without changing max effort or retrying',async()=>{
  const ports:number[]=[],requests:unknown[]=[],connections:(string|undefined)[]=[];
  const server=createServer(async(req,res)=>{ports.push(req.socket.remotePort!);connections.push(req.headers.connection);const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const events=[{type:'message_start',message:{id:'fixture-message',type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'READY'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}];res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  try{const config=resolveAdapterOptions({baseURL:`http://127.0.0.1:${address.port}/anthropic`,thinking:'enabled',reasoningEffort:'max',maxTokens:16384,retryPolicy:{mode:'normal',maxRetries:0}}),adapter=new DeepSeekAdapter({options:()=>config,providerName:'local-fixture',resolveAuth:async()=>({headers:{'x-api-key':'local-fixture-only',...REAL_CONNECTION_HEADERS}}),resolveUserId:()=>getOrCreateAnonymousUserId(),prepareExtensions:async()=>({fields:{},accept:async()=>{}})});
    for(let i=0;i<2;i++){let text='',finished=false;for await(const chunk of adapter.stream({provider:'deepseek-official',model:'deepseek-flash',maxTokens:16384,reasoningEffort:ReasoningEffortId('max'),signal:AbortSignal.timeout(5000),messages:[createUserMessage({source:{kind:'user'},content:[{type:'text',text:'本机回环测试'}]})]})){if(chunk.type==='text-delta')text+=chunk.text;if(chunk.type==='finish'){assert.equal(chunk.reason.kind,'stop');finished=true;}}assert.equal(text,'READY');assert.ok(finished);}
    assert.equal(requests.length,2);assert.equal(new Set(ports).size,2);assert.deepEqual(connections,['close','close']);for(const request of requests){const body=z.object({model:z.string(),max_tokens:z.number(),thinking:z.object({type:z.string()}),output_config:z.object({effort:z.string()})}).parse(request);assert.equal(body.model,'deepseek-flash');assert.equal(body.max_tokens,16384);assert.equal(body.thinking.type,'enabled');assert.equal(body.output_config.effort,'max');}
  }finally{server.closeAllConnections();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));}
});
