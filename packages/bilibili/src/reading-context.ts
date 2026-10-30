import type { ContextItem,ExecutionContext,ExecutionView,TaskContextContributor } from '@dafeiyu/contracts';
import { BiliStore,biliHash,biliOwner } from './store.js';

type Scope=Pick<ExecutionContext,'scope'|'intentVersion'>&{expiresAt?:string;guard():void;historyGuard?():void};

/** Current task state is refreshed once per request; full readings remain in the task-scoped store. */
export function readingContext(store:BiliStore,grant:(view:ExecutionView)=>Scope|null,ready:()=>boolean):TaskContextContributor {
  const scopes=new Map<string,Scope>();
  const render=(scope:Scope)=>{
    let text='';for(let limit=8;limit>=1;limit--){text=JSON.stringify({kind:'bilibili-reading-progress',instructionAuthority:false,...store.readingView(scope,limit),
      note:'已读范围来自程序记录；短结论是本任务先前判断。详情用 bili_reading_get，原始来源按引用重新打开，缺口不等于任务完成。'});if(Buffer.byteLength(text)<=4000)break;}return text;
  };
  return {id:'reading',prepare:async view=>{
    if(!ready())return [];const scope=grant(view);if(!scope)return [];scope.guard();
    scopes.set(view.runId,scope);if(scopes.size>256)scopes.delete(scopes.keys().next().value!);
    const text=render(scope),version=biliHash(text),owner=biliOwner(scope);
    const visible=JSON.parse(text) as {recent:{bvid:string;version:number}[];open:{bvid:string;version:number}|null};
    const versions=[...new Map([...visible.recent,...(visible.open?[visible.open]:[])].map(record=>[record.bvid,record])).values()];
    return [{id:'bilibili-reading:'+owner,version,text,sources:[{ref:'bilibili-reading:'+owner,version:String(scope.intentVersion),hash:version},
      ...versions.map(record=>({ref:'reading:'+record.bvid,version:String(record.version),hash:biliHash(store.readingVersion(scope,record.bvid,record.version))}))],
      expiresAt:scope.expiresAt??'9999-12-31T23:59:59.999Z'}];
  },validate:(view:ExecutionView,item:ContextItem)=>{
    try{if(!ready())return false;const scope=scopes.get(view.runId);if(!scope||biliHash(scope.scope)!==biliHash(view.scope))return false;
      (scope.historyGuard??scope.guard)();return item.id==='bilibili-reading:'+biliOwner(scope)&&item.version===biliHash(render(scope))&&item.text===render(scope);
    }catch{return false;}
  },validateHistorical:(view,item)=>{
    try{if(!ready())return false;const scope=scopes.get(view.runId);if(!scope)return false;(scope.historyGuard??scope.guard)();
      if(item.id!=='bilibili-reading:'+biliOwner(scope)||item.version!==biliHash(item.text))return false;
      return item.sources.filter(source=>source.ref.startsWith('reading:')).every(source=>{
        const record=store.readingVersion(scope,source.ref.slice(8),Number(source.version));return record!==null&&biliHash(record)===source.hash;
      });
    }catch{return false;}
  }};
}
