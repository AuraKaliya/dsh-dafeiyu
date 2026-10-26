import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile,mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { observeAcceptanceNetwork } from '../../scripts/acceptance-network.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
test('passive network observer correlates requests while never persisting headers, bodies, paths or error messages',async()=>{
  const root=await mkdtemp(join(tmpdir(),'network-observer-')),server=createServer((req,res)=>{if(req.url==='/drop'){req.socket.destroy();return;}res.end('PRIVATE_RESPONSE_SENTINEL');});server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const origin=`http://127.0.0.1:${address.port}`,observer=observeAcceptanceNetwork(root,origin,'a'.repeat(64));
  try{const response=await fetch(origin+'/PRIVATE_PATH_SENTINEL',{method:'POST',headers:{authorization:'PRIVATE_HEADER_SENTINEL',connection:'close'},body:'PRIVATE_BODY_SENTINEL'});assert.equal(await response.text(),'PRIVATE_RESPONSE_SENTINEL');await assert.rejects(fetch(origin+'/drop',{headers:{connection:'close'},signal:AbortSignal.timeout(1000)}));observer.close();const text=await readFile(observer.path,'utf8'),rows=text.trim().split('\n').map(line=>JSON.parse(line));assert.ok(!text.includes('PRIVATE_'));assert.ok(!text.includes(origin));assert.ok(rows.some(r=>r.event==='connection-established'));assert.ok(rows.some(r=>r.event==='body-sent'&&r.request===1));assert.ok(rows.some(r=>r.event==='response-headers'&&r.request===1&&r.status===200));assert.ok(rows.some(r=>r.event==='request-error'&&r.request===2));assert.equal(rows.at(-1).dropped,0);assert.equal(rows.at(-1).requests,2);}finally{observer.close();server.closeAllConnections();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));}
});
test('network preload cannot observe or launch real acceptance from managed tests',()=>{const child=spawnSync(process.execPath,['--import','./scripts/acceptance-network-preload.mjs','-e','throw new Error("MUST_NOT_RUN")'],{encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.ok(child.stderr.includes('LIVE_CALLS_DISABLED_IN_TESTS'));assert.ok(!child.stderr.includes('MUST_NOT_RUN'));});
