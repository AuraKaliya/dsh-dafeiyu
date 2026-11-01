import {z} from 'zod';
import {BiliStore,biliOwner,biliHash} from './store.js';
import {BiliSearchResultSchema} from '@dafeiyu/contracts';
import type {ExecutionContext,BiliReadingRecord} from '@dafeiyu/contracts';

/** A pagination cursor is not a credential. Give the public view an unambiguous field name. */
export function publicReadingRecord(record:BiliReadingRecord){
  if(!record.commentCursor)return record;
  const {token,...cursor}=record.commentCursor;
  return {...record,commentCursor:{...cursor,...(token?{cursor:token}:{})}};
}

const framePointSchema=z.object({positionMs:z.number().int().nonnegative(),sourceKey:z.string().max(200).nullable(),ok:z.boolean(),errorCode:z.string().nullable().optional()});
const captureSchema=z.object({source:z.object({key:z.string().max(200)}),positionMs:z.number().int().nonnegative()});

/** Search candidates and captured-but-not-yet-understood frames are durable work state,
 * not conclusions the model must remember to save. */
export function readingResume(store:BiliStore,scope:Pick<ExecutionContext,'scope'|'intentVersion'>,onlyBvid?:string){
  const owner=biliOwner(scope),pages=store.pages(owner).filter(page=>store.observation(page));
  const videos=store.observedVideoPages(owner);
  const search=store.recentSearchPages(owner,3).flatMap(page=>{
    const parsed=BiliSearchResultSchema.safeParse(page.data);if(!parsed.success)return [];
    return [{pageId:page.id,hash:biliHash(page),keyword:parsed.data.keyword,order:parsed.data.order,page:parsed.data.page,nextPage:parsed.data.nextPage,
      items:parsed.data.items.slice(0,8).map(item=>({bvid:item.bvid,title:item.title,author:item.author,publishedAt:item.publishedAt,views:item.views,durationSeconds:item.durationSeconds}))}];
  }).slice(0,3);
  const ids=onlyBvid?[onlyBvid]:[...new Set(videos.map(page=>z.object({bvid:z.string()}).parse(page.data).bvid))].slice(0,2);
  const resumed=ids.flatMap(bvid=>{
    const observed=store.videoPages(owner,bvid),video=observed.find(page=>page.kind==='video');if(!video)return [];
    const body=z.object({bvid:z.string(),aid:z.string().nullable(),pages:z.array(z.object({cid:z.string(),durationSeconds:z.number()}))}).safeParse(video.data);if(!body.success)return [];
    const latest=observed.find(page=>page.kind==='subtitles');
    const subtitles=latest?z.object({cid:z.string(),track:z.object({id:z.string()}).optional(),tracks:z.array(z.object({id:z.string(),language:z.string()})).optional(),range:z.object({startMs:z.number(),endMs:z.number()}).optional(),offset:z.number().optional(),nextOffset:z.number().nullable().optional()}).safeParse(latest.data):null;
    const comment=observed.find(page=>page.kind==='comments'),comments=comment?z.object({nextCursor:z.string().nullable()}).safeParse(comment.data):null;
    const capturePages=observed.filter(page=>page.kind==='browser'||page.kind==='media');
    const frames=capturePages.flatMap(page=>{
      const points=z.array(framePointSchema).safeParse((page.data as Record<string,unknown>).points);
      if(points.success)return points.data.filter(point=>point.ok).map(point=>({pageId:page.id,positionMs:point.positionMs,sourceKey:point.sourceKey,errorCode:point.errorCode??null}));
      const capture=captureSchema.safeParse(page.kind==='browser'?(page.data as Record<string,unknown>).capture:page.data);
      return capture.success?[{pageId:page.id,positionMs:capture.data.positionMs,sourceKey:capture.data.source.key,errorCode:null}]:[];
    }).filter((frame,index,all)=>all.findIndex(other=>other.sourceKey===frame.sourceKey&&other.positionMs===frame.positionMs)===index).slice(0,32);
    const judgementSaved=store.reading(scope,bvid)!==null;
    const framesState=frames.length?(frames.some(frame=>frame.sourceKey)?'captured-visual-state-unknown':'capture-incomplete'):null;
    const nextStep=frames.some(frame=>frame.sourceKey)
      ? '画面 source 已获取；视觉理解没有独立回执记录。继续前先核对是否已用 dafeiyu_media_read 理解这些采样点：未理解则读取，已理解则不重复抓图。'
      : subtitleTrackCount(subtitles?.data)>0&&!subtitles?.data?.range?'已列出字幕轨但未取得正文；继续用 bili_subtitles 读取正文。'
      : comments?.data?.nextCursor?'继续读取下一页评论，或依据已有样本收束。'
      : search.length&&!judgementSaved?'比较已返回候选并选择一条继续读取；不要无理由重搜第一页。'
      : null;
    return [{bvid,videoPageId:video.id,aid:body.data.aid,parts:body.data.pages.slice(0,2),
      subtitle:latest&&subtitles?.success?{pageId:latest.id,...subtitles.data,...(subtitles.data.tracks?{tracks:subtitles.data.tracks.slice(0,3),totalTracks:subtitles.data.tracks.length}:{})}:null,
      comments:comment&&comments?.success?{pageId:comment.id,...comments.data}:null,
      frames,framesState,judgementSaved,nextStep,
      // Context sources must describe only visible page handles and stay within the contract's 16-source bound.
      sources:[...new Map([video,...(latest?[latest]:[]),...(comment?[comment]:[]),...capturePages].map(page=>[page.id,{pageId:page.id,hash:biliHash(page)}])).values()].slice(0,16)}];
  });
  return {...(search.length?{search}:{}),resume:resumed};
}
function subtitleTrackCount(value:{tracks?:readonly {id:string}[]|undefined;track?:{id:string}|undefined}|undefined){return (value?.tracks?.length??0)+(value?.track?1:0);}
