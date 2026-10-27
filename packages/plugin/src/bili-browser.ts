import {BiliBrowserRequestSchema,BiliBrowserResultSchema,redactContent} from '@dafeiyu/contracts';
import type {BiliBrowserRequest,BiliBrowserResult,Json} from '@dafeiyu/contracts';
import {setTimeout} from 'node:timers/promises';
import {z} from 'zod';
export type BrowserToolCall=(name:string,args:Record<string,Json>,signal:AbortSignal)=>Promise<unknown>;
/** Internal clock seam for deterministic tests; never accepted from model/tool arguments. */
export interface BrowserReadinessClock {
  now():number;
  wait(ms:number,signal:AbortSignal):Promise<void>;
}
const readinessClock:BrowserReadinessClock={now:()=>performance.now(),wait:async(ms,signal)=>{await setTimeout(ms,undefined,{signal});}};
const readinessMs=10000,pollMs=250;
// Fixed DOM reads only. No credential export, account switching, arbitrary scripts or publication action.
const identityScript="(()=>{const ids=Array.from(document.querySelectorAll('a[href]')).filter(a=>{const r=a.getBoundingClientRect();const u=new URL(a.href);return r.width>0&&r.height>0&&r.top>=0&&r.top<60&&r.left>innerWidth*0.55&&u.hostname==='space.bilibili.com'&&/^\\/\\d+\\/?$/.test(u.pathname);}).map(a=>new URL(a.href).pathname.replaceAll('/',''));return {url:location.href,ids};})()";
const videoScript="(()=>{const title=document.querySelector('h1')?.innerText?.trim();if(!title)return null;const text=document.querySelector('#v_desc')?.innerText||document.querySelector('.basic-desc-info')?.innerText||title;return {title:title.slice(0,300),text:text.slice(0,5000),truncated:text.length>5000};})()";
const commentsScript="(()=>{const host=document.querySelector('bili-comments'),root=host?.shadowRoot||document.querySelector('#comment');if(!root)return null;const parts=[];let ready=false;const walk=n=>{if(n.nodeType===1&&(['STYLE','SCRIPT','TEMPLATE','NOSCRIPT','SVG'].includes(n.tagName)||n.hidden))return;const start=parts.length;if(n.nodeType===3&&n.textContent.trim())parts.push(n.textContent.trim());for(const c of n.childNodes||[])walk(c);if(n.shadowRoot)walk(n.shadowRoot);if(n.nodeType===1&&n.matches('bili-comment-thread-renderer,.reply-item,.list-item')&&parts.length>start)ready=true;};walk(root);const text=parts.join('\\n');if(!ready||!text.trim())return null;return {title:(document.querySelector('h1')?.innerText||document.title).slice(0,300),text:text.slice(0,5000),truncated:text.length>5000};})()";
function evaluated(raw:unknown):unknown{const value=z.object({ok:z.literal(true),value:z.string()}).parse(raw);return JSON.parse(value.value) as unknown;}
export async function readBiliBrowser(request:BiliBrowserRequest,expectedUid:string,call:BrowserToolCall,signal:AbortSignal,clock:BrowserReadinessClock=readinessClock):Promise<BiliBrowserResult>{
  const input=BiliBrowserRequestSchema.parse(request);z.string().regex(/^[1-9]\d{0,19}$/).parse(expectedUid);signal.throwIfAborted();const url=`https://www.bilibili.com/video/${input.bvid}/`;
  const opened=z.object({url:z.string(),challenge:z.object({blocked:z.boolean()}).optional()}).parse(await call('dsh_browser_open',{url},signal));
  const verifyUrl=(value:string)=>{const actual=new URL(value);if(actual.origin!=='https://www.bilibili.com'||actual.pathname!==new URL(url).pathname)throw new Error('BILI_BROWSER_REDIRECT');};
  verifyUrl(opened.url);
  if(opened.challenge?.blocked)throw new Error('BILI_BROWSER_CHALLENGE');
  // One shared budget after navigation. Poll only the existing DOM, never reload or retry an API request.
  const deadline=clock.now()+readinessMs,readySignal=AbortSignal.any([signal,AbortSignal.timeout(readinessMs)]);
  const waitReady=async<T>(read:()=>Promise<T|null>,code:string):Promise<T>=>{
    try{for(;;){signal.throwIfAborted();readySignal.throwIfAborted();if(clock.now()>=deadline)throw new Error(code);
      const value=await read();signal.throwIfAborted();readySignal.throwIfAborted();if(clock.now()>=deadline)throw new Error(code);
      if(value!==null)return value;await clock.wait(Math.min(pollMs,deadline-clock.now()),readySignal);
    }}catch(error){signal.throwIfAborted();if(readySignal.aborted)throw new Error(code);throw error;}
  };
  const verify=()=>waitReady(async()=>{const state=z.object({url:z.string(),ids:z.array(z.string().regex(/^[1-9]\d{0,19}$/)).max(20)}).parse(evaluated(await call('dsh_browser_execute',{script:identityScript},readySignal)));verifyUrl(state.url);
    if(state.ids.some(id=>id!==expectedUid))throw new Error('BILI_BROWSER_ACCOUNT_MISMATCH');
    return state.ids.length?true:null;
  },'BILI_BROWSER_IDENTITY_UNAVAILABLE');
  await verify();
  if(input.section==='comments')await waitReady(async()=>{await call('dsh_browser_scroll',{deltaY:850},readySignal);return true;},'BILI_BROWSER_CONTENT_UNAVAILABLE');
  const content=await waitReady(async()=>{
    const value=evaluated(await call('dsh_browser_execute',{script:input.section==='comments'?commentsScript:videoScript},readySignal));if(value===null)return null;
    const parsed=z.object({title:z.string().max(300),text:z.string().max(5000),truncated:z.boolean()}).parse(value);return parsed.text.trim()?parsed:null;
  },'BILI_BROWSER_CONTENT_UNAVAILABLE');
  await verify();
  return BiliBrowserResultSchema.parse({transport:'dsh-browser',accountUid:expectedUid,bvid:input.bvid,section:input.section,url,title:redactContent(content.title).value,text:redactContent(content.text).value,truncated:content.truncated,observedAt:new Date().toISOString()});
}
