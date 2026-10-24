import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OperationScope } from '@dafeiyu/contracts';
import { MemoryStore } from '@dafeiyu/memory/store';
import { MemoryRetrieval } from '@dafeiyu/memory/retrieval';
import { defaultProfile, loadProfile, RetrievalError } from '@dafeiyu/memory/retrieval-profile';
import type { EmbeddingProfile, RetrievalConfig, RetrievalDependencies, TextChunk } from '@dafeiyu/memory/retrieval-profile';

export function scope(route='a'): OperationScope {
  return {agentId:'fish',route,traceId:randomUUID(),operationId:randomUUID(),startedEventId:randomUUID()};
}
export function content(text: string) {
  return {kind:'knowledge' as const,claimType:'self_report' as const,content:text,
    sources:[{kind:'timeline' as const,ref:`dafeiyu:event:${randomUUID()}`,contentHash:'a'.repeat(64)}]};
}
export const config: RetrievalConfig = {endpoint:'http://127.0.0.1:6190/v1/embeddings',python:'fixture-only',modelDir:'fixture-only',serviceFile:'fixture-only'};
export function fakeDependencies(profile: EmbeddingProfile = loadProfile().profile) {
  const calls: string[][] = [];
  const chunksCalled: string[] = [];
  const dependency: RetrievalDependencies = {
    tokenizer:{
      chunks:async(text,signal)=>{
        signal.throwIfAborted();chunksCalled.push(text);const points=Array.from(text),result:TextChunk[]=[];
        const step=Math.min(profile.chunkTokens-2,profile.chunkChars);
        for(let start=0;start<points.length;start+=step){const end=Math.min(start+step,points.length);result.push({start,end,text:points.slice(start,end).join(''),tokens:end-start+2});}
        return result;
      },
      query:async(text,signal)=>{signal.throwIfAborted();const prepared=profile.queryPrefix+text;if(Array.from(prepared).length+2>512)throw new RetrievalError('query_too_long');return {text:prepared,tokens:Array.from(prepared).length+2};},
      close:()=>{},
    },
    embedder:{embed:async(texts,signal)=>{
      signal.throwIfAborted();calls.push([...texts]);
      return texts.map(text=>{
        const vector=Array<number>(512).fill(0);
        for(const char of Array.from(text.replace(profile.queryPrefix,'')))vector[(char.codePointAt(0)??0)%512]!+=1;
        if(/下雨|雨伞|降水/.test(text))vector[0]!+=20;
        const norm=Math.sqrt(vector.reduce((sum,n)=>sum+n*n,0));return vector.map(n=>n/norm);
      });
    },close:()=>{}},
  };
  return {dependency,calls,chunksCalled};
}
export async function retrievalFixture(overrides: Partial<RetrievalConfig> = {}) {
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-retrieval-'));
  const store=new MemoryStore(join(root,'memory.sqlite'));
  const fake=fakeDependencies();
  const retrieval=new MemoryRetrieval(store,root,{...config,...overrides},fake.dependency);
  return {root,store,retrieval,...fake,
    seed:(text:string,route='a')=>store.mutate(scope(route),{action:'create',requestId:randomUUID(),value:content(text)}),
    recall:(query:string,strategy:'lexical'|'semantic'|'hybrid'='hybrid',route='a',rebuild=false)=>retrieval.recall(scope(route),{query,strategy,rebuild},AbortSignal.timeout(5000),()=>{}),
    close:()=>{retrieval.close();store.close();},
  };
}
export async function alteredProfile(root: string) {
  const profile=JSON.parse(await readFile(defaultProfile,'utf8'));profile.queryPrefix='用于查找虚构记忆：';
  const path=join(root,'alternate-profile.json');await writeFile(path,JSON.stringify(profile));return path;
}
