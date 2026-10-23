import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import * as Timeline from '@dafeiyu/timeline';
import { API_VERSION } from '@dafeiyu/contracts';
import type { ActionContext } from '@dafeiyu/contracts';
import { harness, call, textReply } from './harness.js';
import type { Response } from './harness.js';

export async function timelineFixture(existingRoot?: string) {
  const root=existingRoot??await mkdtemp(join(tmpdir(),'dafeiyu-timeline-'));
  let response:Response=()=>textReply('正常回复');
  let analysisResponse:Response=()=>textReply(JSON.stringify({schemaVersion:1,overview:'没有候选',gaps:[],claims:[]}));
  const h=await harness(root,options=>String(options.sessionId).startsWith('memory-analysis-')?analysisResponse(options):response(options));
  const queryFiber=await h.ctx.plugin(Query,{path:join(root,'query.sqlite'),openAt:'never'});
  const timelineFiber=await h.ctx.plugin(Timeline,{agentId:'dafeiyu',maxPageChars:2000});
  const timeline=h.ctx.dafeiyuTimeline;
  let id=0;
  return {...h,root,timeline,timelineFiber,
    setResponse:(next:Response)=>{response=next;},
    setAnalysisResponse:(next:Response)=>{analysisResponse=next;},
    seed:async(room:string,text='一条原始消息')=>{
      response=()=>textReply('原始最终回复');
      const receipt=h.simulator.send(room,text,{id:crypto.randomUUID()});await h.core.whenIdle();return h.core.journal.get(receipt.id);
    },
    probe:async<T>(room:string,execute:(context:ActionContext)=>Promise<T>|T):Promise<T>=>{
      const holder:{value?:T;error?:unknown}={};let request=0;
      const handle=h.core.registerExtension({id:'timeline-probe',version:'test',apiVersion:API_VERSION,agentId:'dafeiyu',actions:[{
        name:'timeline_probe',description:'测试中调用只读接口',fields:{},execute:async(_args,context)=>{
          try{const result=await execute(context);holder.value=result;return z.json().parse(result);}
          catch(error){holder.error=error;throw error;}
        },
      }]});
      response=()=>++request===1?call('timeline_probe',{}):textReply('回查完成');
      try{h.simulator.send(room,'测试来源回查',{id:'probe-'+(++id)+'-'+crypto.randomUUID()});await h.core.whenIdle();if(holder.error)throw holder.error;if(holder.value===undefined)throw new Error('Probe did not execute');return holder.value;}
      finally{handle.dispose();}
    },
    close:async()=>{await timelineFiber.dispose();await queryFiber.dispose();await h.close();},
  };
}
