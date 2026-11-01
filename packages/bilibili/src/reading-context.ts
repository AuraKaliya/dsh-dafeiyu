import type { ContextItem,ExecutionContext,ExecutionView,TaskContextContributor } from '@dafeiyu/contracts';
import { BiliStore,biliHash,biliOwner } from './store.js';
import {readingResume} from './reading-resume.js';

type Scope=Pick<ExecutionContext,'scope'|'intentVersion'>&{expiresAt?:string;guard():void;historyGuard?():void;mediaReadings?():readonly import('@dafeiyu/contracts').Json[]};
const MAX_TEXT_BYTES=15000;
const MAX_PAGES=15;

/** Current task state is refreshed once per request; full readings remain in the task-scoped store. */
export function readingContext(store:BiliStore,grant:(view:ExecutionView)=>Scope|null,ready:()=>boolean,media:(view:ExecutionView)=>readonly import('@dafeiyu/contracts').Json[]=()=>[]):TaskContextContributor {
  const scopes=new Map<string,Scope>();const views=new WeakMap<Scope,ExecutionView>();
  const mediaFor=(scope:Scope)=>scope.mediaReadings?.()??(views.has(scope)?media(views.get(scope)!):[]);
  /** Text and sources come from the same filtered projection, so every displayed frame/search page
   * has a matching validated source and history validation covers all visible material. */
  const project=(scope:Scope,limit=8)=>{
    const view=store.readingView(scope,limit),resumed=readingResume(store,scope);
    const resume=resumed.resume.slice(0,1),search=(resumed.search??[]).slice(0,2);
    const versions=[...new Map([...view.recent,...(view.open?[view.open]:[])].map(record=>[record.bvid,record])).values()];
    const pages=[...new Map([...resume.flatMap(record=>record.sources),...search.map(group=>({pageId:group.pageId,hash:group.hash}))].map(source=>[source.pageId,source])).values()].slice(0,Math.max(0,MAX_PAGES-versions.length));
    const visible=new Set(pages.map(source=>source.pageId));
    const frames=resume[0]?.frames.filter(frame=>visible.has(frame.pageId))??[],omittedFrames=(resume[0]?.frames.length??0)-frames.length;
    const viewed=resume.map(record=>({...record,frames})),shownSearch=search.filter(group=>visible.has(group.pageId)).map(group=>({...group,items:group.items.slice(0,4)}));
    const text=JSON.stringify({kind:'bilibili-reading-progress',instructionAuthority:false,...view,mediaReadings:mediaFor(scope).slice(0,8),
      open:view.open?{...view.open,title:view.open.title.slice(0,80),nextStep:view.open.nextStep?.slice(0,100)??null}:null,
      recent:view.recent.map(record=>({...record,title:record.title.slice(0,80),conclusion:record.conclusion?.slice(0,120)??null})),resume:viewed,
      ...(shownSearch.length?{search:shownSearch}:{}),...(omittedFrames>0?{omittedFrames,continueEntry:'bili_reading_get 分页读取完整来源'}:{}),
      note:'resume 是实际已观察页面，未保存判断也保留。复用 videoPageId/cid/track/nextOffset 续读；judgementSaved=false 不等于未读过。frames 是已获取画面，framesState 只说明抓图；mediaReadings 是已完成的实际媒体理解回执，按 pageId 关联覆盖，不重复读取已理解且仍有效的采样，也不把结论当视觉回执。search 是已返回候选，不要无理由重搜第一页。字幕不是完整观看，详情用 bili_reading_get。'});
    return {text,pages,versions};
  };
  const bounded=(scope:Scope)=>{let projected=project(scope,8);for(let limit=7;limit>=1&&Buffer.byteLength(projected.text)>MAX_TEXT_BYTES;limit--)projected=project(scope,limit);return projected;};
  return {id:'reading',prepare:async view=>{
    if(!ready())return [];const scope=grant(view);if(!scope)return [];scope.guard();
    scopes.set(view.runId,scope);views.set(scope,view);if(scopes.size>256)scopes.delete(scopes.keys().next().value!);
    const {text,pages,versions}=bounded(scope),version=biliHash(text),owner=biliOwner(scope);
    return [{id:'bilibili-reading:'+owner,version,text,sources:[{ref:'bilibili-reading:'+owner,version:String(scope.intentVersion),hash:version},
      ...versions.map(record=>({ref:'reading:'+record.bvid,version:String(record.version),hash:biliHash(store.readingVersion(scope,record.bvid,record.version))})),
      ...pages.map(source=>({ref:'page:'+source.pageId,version:'1',hash:source.hash}))].slice(0,16),
      expiresAt:scope.expiresAt??'9999-12-31T23:59:59.999Z'}];
  },validate:(view:ExecutionView,item:ContextItem)=>{
    try{if(!ready())return false;const scope=scopes.get(view.runId);if(!scope||biliHash(scope.scope)!==biliHash(view.scope))return false;
      (scope.historyGuard??scope.guard)();const projected=bounded(scope);
      return item.id==='bilibili-reading:'+biliOwner(scope)&&item.version===biliHash(projected.text)&&item.text===projected.text;
    }catch{return false;}
  },validateHistorical:(view,item)=>{
    try{if(!ready())return false;const scope=scopes.get(view.runId);if(!scope)return false;(scope.historyGuard??scope.guard)();
      if(item.id!=='bilibili-reading:'+biliOwner(scope)||item.version!==biliHash(item.text))return false;
      const prior=JSON.parse(item.text) as {mediaReadings?:unknown[]},current=mediaFor(scope).map(row=>biliHash(row));if(prior.mediaReadings?.some(row=>!current.includes(biliHash(row))))return false;
      return item.sources.filter(source=>source.ref.startsWith('page:')).every(source=>biliHash(store.page(biliOwner(scope),source.ref.slice(5)))===source.hash)&&item.sources.filter(source=>source.ref.startsWith('reading:')).every(source=>{
        const record=store.readingVersion(scope,source.ref.slice(8),Number(source.version));return record!==null&&biliHash(record)===source.hash;
      });
    }catch{return false;}
  }};
}
