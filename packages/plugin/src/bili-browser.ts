import {BiliBrowserRequestSchema,BiliBrowserResultSchema,redactContent} from '@dafeiyu/contracts';
import type {BiliBrowserRequest,BiliBrowserResult,Json} from '@dafeiyu/contracts';
import {z} from 'zod';
export type BrowserToolCall=(name:string,args:Record<string,Json>,signal:AbortSignal)=>Promise<unknown>;
// Fixed DOM reads only. No credential export, account switching, arbitrary scripts or publication action.
const identityScript="Array.from(document.querySelectorAll('a[href]')).filter(a=>{const r=a.getBoundingClientRect();const u=new URL(a.href);return r.top>=0&&r.top<60&&r.left>innerWidth*0.55&&u.hostname==='space.bilibili.com'&&/^\\/\\d+\\/?$/.test(u.pathname);}).map(a=>new URL(a.href).pathname.replaceAll('/',''))";
const videoScript="(()=>{const text=document.querySelector('#v_desc')?.innerText||document.querySelector('.basic-desc-info')?.innerText||document.querySelector('h1')?.innerText||'';return {title:(document.querySelector('h1')?.innerText||document.title).slice(0,300),text:text.slice(0,5000),truncated:text.length>5000};})()";
const commentsScript="(()=>{const host=document.querySelector('bili-comments'),root=host?.shadowRoot||document.querySelector('#comment');if(!root)return null;const parts=[];const walk=n=>{if(n.nodeType===1&&(['STYLE','SCRIPT','TEMPLATE','NOSCRIPT','SVG'].includes(n.tagName)||n.hidden))return;if(n.nodeType===3&&n.textContent.trim())parts.push(n.textContent.trim());for(const c of n.childNodes||[])walk(c);if(n.shadowRoot)walk(n.shadowRoot);};walk(root);const text=parts.join('\\n');return {title:(document.querySelector('h1')?.innerText||document.title).slice(0,300),text:text.slice(0,5000),truncated:text.length>5000};})()";
function evaluated(raw:unknown):unknown{const value=z.object({ok:z.literal(true),value:z.string()}).parse(raw);return JSON.parse(value.value) as unknown;}
export async function readBiliBrowser(request:BiliBrowserRequest,expectedUid:string,call:BrowserToolCall,signal:AbortSignal):Promise<BiliBrowserResult>{
  const input=BiliBrowserRequestSchema.parse(request);z.string().regex(/^[1-9]\d{0,19}$/).parse(expectedUid);signal.throwIfAborted();const url=`https://www.bilibili.com/video/${input.bvid}/`;
  const opened=z.object({url:z.string(),challenge:z.object({blocked:z.boolean()}).optional()}).parse(await call('dsh_browser_open',{url},signal));
  const actual=new URL(opened.url);if(actual.origin!=='https://www.bilibili.com'||actual.pathname!==new URL(url).pathname)throw new Error('BILI_BROWSER_REDIRECT');
  if(opened.challenge?.blocked)throw new Error('BILI_BROWSER_CHALLENGE');
  const verify=async()=>{signal.throwIfAborted();const ids=z.array(z.string()).max(20).parse(evaluated(await call('dsh_browser_execute',{script:identityScript},signal)));if(ids.length!==1||ids[0]!==expectedUid)throw new Error('BILI_BROWSER_ACCOUNT_MISMATCH');};
  await verify();
  if(input.section==='comments')await call('dsh_browser_scroll',{deltaY:850},signal);
  const value=evaluated(await call('dsh_browser_execute',{script:input.section==='comments'?commentsScript:videoScript},signal));if(value===null)throw new Error('BILI_BROWSER_CONTENT_UNAVAILABLE');
  const content=z.object({title:z.string().max(300),text:z.string().min(1).max(5000),truncated:z.boolean()}).parse(value);await verify();
  return BiliBrowserResultSchema.parse({transport:'dsh-browser',accountUid:expectedUid,bvid:input.bvid,section:input.section,url,title:redactContent(content.title).value,text:redactContent(content.text).value,truncated:content.truncated,observedAt:new Date().toISOString()});
}
