import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ManagedHost } from '@dafeiyu/host';
import type {} from '@deepseek-ai/dsh-deepseek-account';
import { testTempDir } from './test-temp.js';

const scenario=process.argv[2];assert.ok(['media','stale','denied','oversize','truncated','credential','account','account-401','account-foreign','account-missing','account-plain'].includes(scenario??''));
const account=scenario!.startsWith('account'),success=scenario==='media'||scenario==='account';
const root=await mkdtemp(join(testTempDir(),'host-inline-model-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite'),credential=join(root,'synthetic-credential.yaml');
process.env.DSH_HOME=join(root,'core/dsh-home');
const {ManagedHost:Host,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
const {ScopedImages}=await import('../packages/media/lib/images.js');
const {MediaAnalysis}=await import('../packages/media/lib/analysis.js');
const {createImageFixture}=await import('./phase1-image-fixture.js');
const {z}=await import('zod');
const route={provider:account?'deepseek-account':'deepseek-official',model:'deepseek-flash',reasoningEffort:'max'},fixtures=[createImageFixture(13),createImageFixture(17)];
const accountToken='fictional-account-provider-credential-0123456789';
const credentialText=account?JSON.stringify({version:1,refs:{},records:scenario==='account-missing'?{}:{'deepseek-account-platform/default':{kind:'grant',payload:{version:1,token:accountToken,issuer:scenario==='account-foreign'?'https://foreign.example':'https://platform.deepseek.com'}}}}):'version: 1\nrefs:\n  DEEPSEEK_API_KEY: fictional-inline-provider-credential-0123456789\nrecords: {}\n';
const config={schemaVersion:1,profileId:'inline-model-fixture',agent:{id:'dafeiyu'},paths:{core:'./core',memory:'./memory',sessions:'./sessions',query:'./query.sqlite',channels:{}},
  persona:{fixedFile:'./persona.md',kind:'test'},modelRoutes:{chat:route},runtime:{turnTimeoutMs:3000,shutdownGraceMs:500},
  plugins:[{id:'model-deepseek',required:true,config:{...(account?{auth:'dsh-account'}:{}),credentialStore:'./synthetic-credential.yaml',...(scenario==='account-plain'?{}:{inlineTransport:{contextWindow:1000000,maxOutputTokens:2048,maxInlineImageBytes:scenario==='oversize'?1024:8*1024*1024}})}}],authorityPolicies:[]};
await writeFile(join(root,'persona.md'),'虚构视觉预算接线底色。');await writeFile(credential,credentialText);await writeFile(file,JSON.stringify(config));
const prepared=loadHostConfig(file);initializeProfile(prepared,coordination);
const originalFetch=globalThis.fetch;let http=0,filesApi=0,reserved=0,settled=0,unknown=0,guards=0;const sessions:string[]=[];
const image=z.object({type:z.literal('image'),source:z.object({type:z.literal('base64'),media_type:z.literal('image/png'),data:z.string()})});
globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.hostname!=='api.deepseek.com'||url.protocol!=='https:')throw new Error('UNEXPECTED_FIXTURE_ENDPOINT');
  if(url.pathname!=='/anthropic/v1/messages'&&url.pathname!=='/anthropic/messages'){filesApi++;throw new Error('FILES_HTTP_MUST_NOT_BE_REACHED');}
  http++;assert.equal(init?.method,'POST');assert.equal(reserved,1);
  const headers=new Headers(init?.headers);if(account){assert.equal(headers.get('x-dsh-auth-token'),accountToken);assert.equal(headers.has('x-api-key'),false);}else assert.equal(headers.has('x-dsh-auth-token'),false);
  const body=z.object({messages:z.array(z.object({content:z.array(z.unknown())})),max_tokens:z.literal(2048)}).parse(JSON.parse(String(init?.body)));
  const pictures=body.messages.flatMap(message=>message.content).flatMap(block=>{const parsed=image.safeParse(block);return parsed.success?[parsed.data]:[];});
  assert.equal(pictures.length,2);pictures.forEach((picture,i)=>assert.ok(Buffer.from(picture.source.data,'base64').equals(fixtures[i]!.data)));
  assert.equal(JSON.stringify(body).includes('file_id'),false);
  if(scenario==='stale')return new Response(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'file id has expired'}}),{status:400,headers:{'content-type':'application/json'}});
  if(scenario==='account-401')return new Response(JSON.stringify({type:'error',error:{type:'authentication_error',message:'fictional expired login'}}),{status:401,headers:{'content-type':'application/json'}});
  const answer='{"images":2,"fixture":true}',events:unknown[]=[
    {type:'message_start',message:{id:'msg_inline_fixture',type:'message',role:'assistant',model:'deepseek-flash',content:[],usage:{input_tokens:60,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text:answer}},
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:8}},
    ...(scenario==='truncated'?[]:[{type:'message_stop'}])];
  return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{status:200,headers:{'content-type':'text/event-stream'}});
};
let host:ManagedHost|undefined,images:InstanceType<typeof ScopedImages>|undefined;
try{
  if(scenario==='account-plain'){
    await assert.rejects(()=>Host.start(prepared,{coordination,mode:'single-run',installModelAdmission:async ctx=>{assert.equal((await ctx.deepseekAccount.getState()).status,'credential-stored');assert.equal(ctx.get('dafeiyu'),undefined);throw new Error('FIXTURE_ACCOUNT_PROVIDER_MOUNTED');}}),/FIXTURE_ACCOUNT_PROVIDER_MOUNTED/);
    assert.equal(http,0);assert.equal((await import('node:fs')).readFileSync(credential,'utf8'),credentialText);
  }else if(scenario==='account-foreign'||scenario==='account-missing'){
    await assert.rejects(()=>Host.start(prepared,{coordination,mode:'single-run'}),scenario==='account-foreign'?/HOST_ACCOUNT_RECORD_UNSUPPORTED/:/HOST_ACCOUNT_SIGN_IN_REQUIRED/);
    assert.equal((await import('node:fs')).readFileSync(credential,'utf8'),credentialText);assert.equal(http,0);
  }else{
  host=await Host.start(prepared,{coordination,mode:'single-run',installModelAdmission:ctx=>{
    ctx.on('llm/stream',async function*(request,next){guards++;sessions.push(String(request.sessionId));if(scenario==='denied')throw new Error('FIXTURE_BUDGET_DENIED');reserved++;
      let validUsage=false,complete=false;try{for await(const chunk of next()){
        if(chunk.type==='usage'){assert.equal(chunk.usage.inputTokens,60);assert.equal(chunk.usage.outputTokens,8);validUsage=true;}
        if(chunk.type==='finish')complete=chunk.reason.kind==='stop';yield chunk;
      }}finally{settled++;if(!validUsage||!complete)unknown++;}
    });
  }});
  assert.equal(http,0);assert.equal(reserved,0);images=new ScopedImages(host.ctx);
  const grant=images.grant(fixtures.map(f=>({...f,mime:'image/png' as const,hasAlpha:false,requestedMs:null,ptsMs:null})),()=>{});
  if(scenario==='credential')await writeFile(credential,credentialText.replace('0123456789','9876543210'));
  const analysis=new MediaAnalysis(host.ctx,images,join(root,'media-analysis'));
  try{
    const work=analysis.run({route,instructions:'这是离线协议夹具，只返回JSON。',input:{purpose:'inline transport fixture'},refs:grant.refs,lease:grant.id,guard:()=>{},parse:value=>z.strictObject({images:z.literal(2),fixture:z.literal(true)}).parse(value)},new AbortController().signal);
    if(success){assert.deepEqual(await work,{images:2,fixture:true});assert.equal(grant.exposure().length,2);assert.equal(unknown,0);}
    else await assert.rejects(work);
    if(scenario==='denied'||scenario==='credential'){assert.equal(reserved,0);assert.equal(settled,0);assert.equal(http,0);assert.throws(()=>grant.exposure(),/MEDIA_IMAGE_NOT_EXPOSED/);}
    else{assert.equal(reserved,1);assert.equal(settled,1);assert.equal(http,scenario==='oversize'?0:1);assert.equal(unknown,success?0:1);}
    if(scenario==='account-401')assert.equal((await host.ctx.deepseekAccount.getState()).status,'signed-out');
    assert.equal(filesApi,0);if(scenario!=='credential'){assert.equal(guards,1);assert.ok(sessions[0]?.startsWith('media-analysis-'));}
    assert.equal(existsSync(join(root,'core/dsh-home/llm-deepseek/files-v3.json')),false);
  }finally{grant.close();}
  }
}finally{images?.close();await host?.close();globalThis.fetch=originalFetch;}
console.log(JSON.stringify({passed:true,realDsh:true,realModel:false,actualHttp:false,serverAccess:false}));
