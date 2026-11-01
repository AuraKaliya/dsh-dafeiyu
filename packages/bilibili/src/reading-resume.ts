import {z} from 'zod';
import {BiliStore,biliOwner,biliHash} from './store.js';
import type {ExecutionContext,BiliReadingRecord} from '@dafeiyu/contracts';

/** A pagination cursor is not a credential. Give the public view an unambiguous field name. */
export function publicReadingRecord(record:BiliReadingRecord){
  if(!record.commentCursor)return record;
  const {token,...cursor}=record.commentCursor;
  return {...record,commentCursor:{...cursor,...(token?{cursor:token}:{})}};
}

/** Actual observed handles survive a segment even before the model saves a reading judgement. */
export function readingResume(store:BiliStore,scope:Pick<ExecutionContext,'scope'|'intentVersion'>,onlyBvid?:string){
  const owner=biliOwner(scope),pages=store.pages(owner).filter(page=>store.observation(page));
  const videos=pages.filter(page=>page.kind==='video');
  const ids=onlyBvid?[onlyBvid]:[...new Set(videos.map(page=>z.object({bvid:z.string()}).parse(page.data).bvid))].slice(0,2);
  return ids.flatMap(bvid=>{
    const observed=store.videoPages(owner,bvid),video=observed.find(page=>page.kind==='video');if(!video)return [];
    const body=z.object({bvid:z.string(),aid:z.string().nullable(),pages:z.array(z.object({cid:z.string(),durationSeconds:z.number()}))}).safeParse(video.data);if(!body.success)return [];
    const latest=observed.find(page=>page.kind==='subtitles');
    const subtitles=latest?z.object({cid:z.string(),track:z.object({id:z.string()}).optional(),tracks:z.array(z.object({id:z.string(),language:z.string()})).optional(),range:z.object({startMs:z.number(),endMs:z.number()}).optional(),offset:z.number().optional(),nextOffset:z.number().nullable().optional()}).safeParse(latest.data):null;
    const comment=observed.find(page=>page.kind==='comments'),comments=comment?z.object({nextCursor:z.string().nullable()}).safeParse(comment.data):null;
    return [{bvid,videoPageId:video.id,aid:body.data.aid,parts:body.data.pages.slice(0,2),
      subtitle:latest&&subtitles?.success?{pageId:latest.id,...subtitles.data,...(subtitles.data.tracks?{tracks:subtitles.data.tracks.slice(0,3),totalTracks:subtitles.data.tracks.length}:{})}:null,
      comments:comment&&comments?.success?{pageId:comment.id,...comments.data}:null,
      judgementSaved:store.reading(scope,bvid)!==null,
      sources:[video,...(latest?[latest]:[]),...(comment?[comment]:[])].map(page=>({pageId:page.id,hash:biliHash(page)}))}];
  });
}
