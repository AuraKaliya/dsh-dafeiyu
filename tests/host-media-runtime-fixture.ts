import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testTempDir } from './test-temp.js';
import { DatabaseSync } from 'node:sqlite';
import type { Context } from '@deepseek-ai/cordis';
import type { MediaSourceDescription } from '@dafeiyu/contracts';

const root=await mkdtemp(join(testTempDir(),'host-media-runtime-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');process.env.DSH_HOME=join(root,'data/core/dsh-home');
const {ManagedHost,loadHostConfig,initializeProfile,readHostStatus}=await import('@dafeiyu/host');
const {MEDIA_ACTIONS}=await import('@dafeiyu/media');const {MediaAssetRefSchema}=await import('@dafeiyu/contracts');
const {ScriptedModel,call,textReply}=await import('./harness.js');const {outcomes}=await import('./qq-capabilities-fixture.js');const {z}=await import('zod');
const scene={channel:'fixture',account:'local',kind:'local' as const,id:'document'},data=Buffer.from('HOST_MEDIA_DOCUMENT：只是一份虚构测试资料。');
const description:MediaSourceDescription={ref:{provider:'fixture',key:'doc'},origin:{provider:'fixture',scene,key:'doc',version:1,hash:'a'.repeat(64),roots:['fixture:doc'],detail:{}},kind:'document',name:'document.txt',mimeHint:'text/plain',bytesHint:data.length,durationMsHint:null,rangeReadable:false,publicContent:false};
const config={schemaVersion:1,profileId:'fixture',agent:{id:'dafeiyu'},paths:{core:'data/core',memory:'data/memory',sessions:'data/sessions',query:'data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'persona.md',kind:'test'},diagnostics:{snapshotIntervalMs:100},
  plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:'memory',required:true,config:{sourceTracking:true}},{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath,documents:{python:'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',pypdfVersion:'6.10.0'}}}],
  authorityPolicies:[{id:'local',producers:['host-cli'],actions:[...MEDIA_ACTIONS],allowLocalWrite:true,resources:[scene]}]};
await writeFile(join(root,'persona.md'),'只用于本地测试的底色，保持好奇并区分推断与事实。');await writeFile(file,JSON.stringify(config));const prepared=loadHostConfig(file);assert.equal(initializeProfile(prepared,coordination).ready,true);
function bind(ctx:Context){const handle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:'fixture',version:'1',agentId:'dafeiyu',resourceProofs:{current:p=>p.hash===description.origin.hash,epoch:()=>''}}),unregister=ctx.dafeiyu.registerMediaProvider({id:'fixture',describe:()=>description,open:async()=>({bytes:data.length,mime:'text/plain',stream:(async function*(){yield data;})()})});return ()=>{unregister();handle.dispose();};}
let step=0;const adapter=new ScriptedModel(request=>{step++;if(step===1)return call('dafeiyu_media_acquire',{requestId:'asset',source:description.ref});if(step===2)return call('dafeiyu_media_read',{requestId:'read',asset:MediaAssetRefSchema.parse(outcomes(request).at(-1)?.data),mode:'document'});
  if(step===3){const view=z.object({exposureId:z.string(),observation:z.object({source:z.object({id:z.string(),version:z.number()})})}).parse(outcomes(request).at(-1)?.data);return call('dafeiyu_media_select',{requestId:'retain',exposureId:view.exposureId,observationId:view.observation.source.id,version:1,mode:'original',reason:'保存虚构Host验证资料'});}return textReply('HOST_MEDIA_RESULT');});
const request={requestId:'one',title:'文档处理',goal:'只处理本地虚构资料',policyId:'local'};
let host=await ManagedHost.start(prepared,{mode:'single-run',coordination,adapter}),unbind=bind(host.ctx);let closed=false;
try{const result=await host.run(request);assert.equal(result.result,'HOST_MEDIA_RESULT');const status=host.snapshot();assert.equal(status.schemas.media,2);assert.equal(status.services.media?.counts.jobs.completed,1);assert.equal(status.services.media?.modalities.documents,true);assert.equal(status.counts.outbox,0);
  assert.ok(!JSON.stringify(status).includes('HOST_MEDIA_DOCUMENT'));assert.equal(readHostStatus(prepared,coordination).snapshot?.services.media?.counts.exports,0);
  unbind();await host.close();closed=true;assert.equal(host.snapshot().services.media?.lifecycle,'closed');const firstCalls=adapter.requests.length;
  const next=new ScriptedModel(()=>{throw new Error('MUST_NOT_REPLAY');});host=await ManagedHost.start(prepared,{mode:'single-run',coordination,adapter:next});closed=false;unbind=bind(host.ctx);assert.equal((await host.run(request)).runId,result.runId);assert.equal(next.requests.length,0);assert.equal(firstCalls,4);
  const db=new DatabaseSync(join(root,'data/core/media.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM media_outbox WHERE delivered=0').get()?.n,0);}finally{db.close();}
}finally{if(!closed){unbind();await host.close();}}
process.stdout.write(JSON.stringify({passed:true,actualLocalHost:true,realModel:false,realPlatform:false,serverAccess:false})+'\n');
