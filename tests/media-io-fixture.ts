import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MediaAccess,MediaSourceDescription } from '@dafeiyu/contracts';
import { taskScopeKey } from '@dafeiyu/contracts';
import { MediaStore } from '../packages/media/lib/store.js';
import { MediaFiles } from '../packages/media/lib/files.js';
import { testTempDir } from './test-temp.js';

export async function mediaIoFixture(maxBytes=1024*1024){
  const directory=await mkdtemp(join(testTempDir(),'media-io-')),store=new MediaStore(join(directory,'media.sqlite'),{agentId:'fixture',profileId:'fixture'},true),files=new MediaFiles(join(directory,'data'),store,maxBytes,maxBytes);
  await files.initialize();const taskId=randomUUID(),scope={kind:'task' as const,agentId:'fixture',taskId,scopeKey:taskScopeKey('fixture',taskId)};
  const description:MediaSourceDescription={ref:{provider:'fixture',key:'bytes'},origin:{provider:'fixture',scene:{channel:'fixture',account:'local',kind:'local',id:'resource'},key:'bytes',version:1,hash:'a'.repeat(64),roots:['synthetic-only'],detail:{}},kind:'document',name:'fixture.txt',mimeHint:'text/plain',bytesHint:null,durationMsHint:null,rangeReadable:true,publicContent:false};
  let valid=true;const guard=()=>{if(!valid)throw new Error('SOURCE_STALE');};const access:MediaAccess={origin:description.origin,guard,execution:{view:{runId:randomUUID(),taskId,scope,origin:{kind:'native',producerId:'fixture',requestId:'fixture'},signal:new AbortController().signal},producer:'fixture',operationId:randomUUID(),startedEventId:randomUUID(),intentVersion:1,motivation:{kind:'explicit-task',basis:[]},inputs:[],admittedSources:[],guard}};
  return {directory,store,files,access,source:store.rememberSource(access,description),invalidate:()=>{valid=false;},close:()=>store.close()};
}
export async function* byteChunks(bytes:Buffer){yield bytes;}
