import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {waitForOneBot} from '../packages/plugin/lib/management-runtime.js';

const settings=(root:string)=>({qq:{botId:'1994142241',tokenFile:join(root,'onebot.token'),httpURL:'http://127.0.0.1:13000/'}});

test('startup preflight requires a real OneBot login for the configured bot',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-onebot-preflight-'));
  try{
    writeFileSync(join(root,'onebot.token'),'token-value\n');
    const calls:string[]=[];
    await waitForOneBot(settings(root),{timeoutMs:1000,fetchImpl:async(url,init)=>{
      calls.push(String(url));assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer token-value');
      return new Response(JSON.stringify({status:'ok',data:{user_id:1994142241}}),{status:200});
    }});
    assert.equal(calls.length,1);
    assert.match(calls[0]!,/get_login_info$/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('startup preflight fails when the token file is missing',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-onebot-preflight-'));
  try{await assert.rejects(waitForOneBot(settings(root),{timeoutMs:10}),/ONEBOT_TOKEN_UNAVAILABLE/);}
  finally{rmSync(root,{recursive:true,force:true});}
});

test('startup preflight waits for the configured identity instead of accepting any login',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-onebot-preflight-'));
  try{
    writeFileSync(join(root,'onebot.token'),'token-value');
    await assert.rejects(waitForOneBot(settings(root),{timeoutMs:20,fetchImpl:async()=>
      new Response(JSON.stringify({status:'ok',data:{user_id:123456}}),{status:200})}),/ONEBOT_IDENTITY_MISMATCH/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
