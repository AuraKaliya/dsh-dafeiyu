import type { ContextItem,ExecutionContext,ExecutionView,TaskContextContributor } from '@dafeiyu/contracts';
import { BiliStore,biliHash,biliOwner } from './store.js';
import {readingResume} from './reading-resume.js';

type Scope=Pick<ExecutionContext,'scope'|'intentVersion'>&{expiresAt?:string;guard():void;historyGuard?():void};

/** Current task state is refreshed once per request; full readings remain in the task-scoped store. */
export function readingContext(store:BiliStore,grant:(view:ExecutionView)=>Scope|null,ready:()=>boolean):TaskContextContributor {
  const scopes=new Map<string,Scope>();
  const render=(scope:Scope)=>{
    let text='';for(let limit=8;limit>=1;limit--){const view=store.readingView(scope,limit),resumed=readingResume(store,scope),resume=resumed.resume.slice(0,1);text=JSON.stringify({kind:'bilibili-reading-progress',instructionAuthority:false,...view,
      open:view.open?{...view.open,title:view.open.title.slice(0,80),nextStep:view.open.nextStep?.slice(0,100)??null}:null,
      recent:view.recent.map(record=>({...record,title:record.title.slice(0,80),conclusion:record.conclusion?.slice(0,120)??null})),resume,
      ...(resumed.search?.length?{search:resumed.search.slice(0,2).map(group=>({...group,items:group.items.slice(0,4)}))}:{}),
      note:'resume 是实际已观察页面，未保存判断也保留。复用 videoPageId/cid/track/nextOffset 续读；judgementSaved=false 不等于未读过。frames 是已获取画面，sourceKey 非空时继续视觉理解而不是重复抓图。search 是已返回候选，不要无理由重搜第一页。字幕不是完整观看，详情用 bili_reading_get。'});if(Buffer.byteLength(text)<=3800)break;}return text;
  };
  return {id:'reading',prepare:async view=>{
    if(!ready())return [];const scope=grant(view);if(!scope)return [];scope.guard();
    scopes.set(view.runId,scope);if(scopes.size>256)scopes.delete(scopes.keys().next().value!);
    const text=render(scope),version=biliHash(text),owner=biliOwner(scope);
    const resumed=readingResume(store,scope),resume=resumed.resume.slice(0,1),shownSearch=(resumed.search??[]).slice(0,2);
    const visible=JSON.parse(text) as {recent:{bvid:string;version:number}[];open:{bvid:string;version:number}|null;resume:{sources:{pageId:string;hash:string}[]}[]};
    const versions=[...new Map([...visible.recent,...(visible.open?[visible.open]:[])].map(record=>[record.bvid,record])).values()];
    const pageSources=[...new Map([...resume.flatMap(record=>record.sources),...shownSearch.map(group=>({pageId:group.pageId,hash:group.hash}))].map(source=>[source.pageId,source])).values()].slice(0,Math.max(0,15-versions.length));
    return [{id:'bilibili-reading:'+owner,version,text,sources:[{ref:'bilibili-reading:'+owner,version:String(scope.intentVersion),hash:version},
      ...versions.map(record=>({ref:'reading:'+record.bvid,version:String(record.version),hash:biliHash(store.readingVersion(scope,record.bvid,record.version))})),
      ...pageSources.map(source=>({ref:'page:'+source.pageId,version:'1',hash:source.hash}))].slice(0,16),
      expiresAt:scope.expiresAt??'9999-12-31T23:59:59.999Z'}];
  },validate:(view:ExecutionView,item:ContextItem)=>{
    try{if(!ready())return false;const scope=scopes.get(view.runId);if(!scope||biliHash(scope.scope)!==biliHash(view.scope))return false;
      (scope.historyGuard??scope.guard)();return item.id==='bilibili-reading:'+biliOwner(scope)&&item.version===biliHash(render(scope))&&item.text===render(scope);
    }catch{return false;}
  },validateHistorical:(view,item)=>{
    try{if(!ready())return false;const scope=scopes.get(view.runId);if(!scope)return false;(scope.historyGuard??scope.guard)();
      if(item.id!=='bilibili-reading:'+biliOwner(scope)||item.version!==biliHash(item.text))return false;
      return item.sources.filter(source=>source.ref.startsWith('page:')).every(source=>biliHash(store.page(biliOwner(scope),source.ref.slice(5)))===source.hash)&&item.sources.filter(source=>source.ref.startsWith('reading:')).every(source=>{
        const record=store.readingVersion(scope,source.ref.slice(8),Number(source.version));return record!==null&&biliHash(record)===source.hash;
      });
    }catch{return false;}
  }};
}
