import { BiliBrowserRequestSchema, BiliBrowserResultSchema, BiliBrowserFrameSchema, redactContent } from '#dafeiyu/contracts';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { contentChallengeCheck } from './bili-page-check.js';
const readinessClock = { now: () => performance.now(), wait: async (ms, signal) => { await setTimeout(ms, undefined, { signal }); } };
const readinessMs = 10000, pollMs = 250;
// Fixed DOM reads only. No credential export, account switching, arbitrary scripts or publication action.
const identityScript = "(()=>{const ids=Array.from(document.querySelectorAll('.header-avatar-wrap .header-entry-mini[href]')).filter(a=>{const r=a.getBoundingClientRect();const u=new URL(a.href);return r.width>0&&r.height>0&&r.top>=0&&r.top<60&&r.left>innerWidth*0.55&&u.hostname==='space.bilibili.com'&&/^\\/\\d+\\/?$/.test(u.pathname);}).map(a=>new URL(a.href).pathname.replaceAll('/',''));return {url:location.href,ids};})()";
const videoScript = "(()=>{const title=document.querySelector('h1')?.innerText?.trim();if(!title)return null;const text=document.querySelector('#v_desc')?.innerText||document.querySelector('.basic-desc-info')?.innerText||title;return {title:title.slice(0,300),text:text.slice(0,5000),truncated:text.length>5000};})()";
const discoverScript = "(()=>{const items=new Map();for(const a of document.querySelectorAll('a[href]')){const u=new URL(a.href),m=/^\\/video\\/(BV[1-9A-HJ-NP-Za-km-z]{10})\\/?$/.exec(u.pathname),r=a.getBoundingClientRect(),title=(a.innerText||a.title||'').trim();if(u.hostname==='www.bilibili.com'&&m&&title&&r.width>0&&r.height>0&&!a.closest('header,footer,.bili-header,.b-footer-wrap')&&!items.has(m[1]))items.set(m[1],title.slice(0,160)+' https://www.bilibili.com/video/'+m[1]+'/');}if(!items.size)return null;const text=Array.from(items.values()).slice(0,20).join('\\n');return {title:'B站当前热门列表',text:text.slice(0,5000),truncated:items.size>20||text.length>5000};})()";
const frameScript = (positionMs) => `(()=>{const v=document.querySelector('video'),title=document.querySelector('h1')?.innerText?.trim();if(!v||!title||!Number.isFinite(v.duration)||v.duration<=0||!v.videoWidth)return null;if(v.mediaKeys)return {error:'BILI_RESTRICTED_MEDIA'};const target=${positionMs}/1000;if(target>=v.duration)return {error:'BILI_BROWSER_POSITION_UNAVAILABLE'};const r=v.getBoundingClientRect();if(!r.width||!r.height)return null;if(Math.abs(v.currentTime-target)>0.35){v.pause();v.currentTime=target;return null;}if(v.seeking||v.readyState<2)return null;try{const c=document.createElement('canvas'),scale=Math.min(1,640/v.videoWidth,360/v.videoHeight);c.width=Math.max(1,Math.round(v.videoWidth*scale));c.height=Math.max(1,Math.round(v.videoHeight*scale));c.getContext('2d').drawImage(v,0,0,c.width,c.height);return {title:title.slice(0,300),text:'仅截取视频的一个实际解码画面，需通过媒体视觉工具阅读；未处理音轨。',truncated:true,frame:{dataUrl:c.toDataURL('image/jpeg',0.8),positionMs:Math.round(v.currentTime*1000),durationMs:Math.round(v.duration*1000)}};}catch{return {error:'BILI_BROWSER_FRAME_UNAVAILABLE'};}})()`;
const homeDiscoverScript = discoverScript.replace("querySelectorAll('a[href]')", "querySelectorAll('.bili-video-card__info--tit a[href]')").replace('B站当前热门列表', 'B站当前首页视频推荐');
const commentsScript = "(()=>{const host=document.querySelector('bili-comments'),root=host?.shadowRoot||document.querySelector('#comment');if(!root)return null;const parts=[];let ready=false;const walk=n=>{if(n.nodeType===1&&(['STYLE','SCRIPT','TEMPLATE','NOSCRIPT','SVG'].includes(n.tagName)||n.hidden))return;const start=parts.length;if(n.nodeType===3&&n.textContent.trim())parts.push(n.textContent.trim());for(const c of n.childNodes||[])walk(c);if(n.shadowRoot)walk(n.shadowRoot);if(n.nodeType===1&&n.matches('bili-comment-thread-renderer,.reply-item,.list-item')&&parts.length>start)ready=true;};walk(root);const text=parts.join('\\n');if(!ready||!text.trim())return null;return {title:(document.querySelector('h1')?.innerText||document.title).slice(0,300),text:text.slice(0,5000),truncated:text.length>5000};})()";
function evaluated(raw) { const value = z.object({ ok: z.literal(true), value: z.string() }).parse(raw); return JSON.parse(value.value); }
export async function readBiliBrowser(request, expectedUid, call, signal, clock = readinessClock) {
    const input = BiliBrowserRequestSchema.parse(request);
    z.string().regex(/^[1-9]\d{0,19}$/).parse(expectedUid);
    signal.throwIfAborted();
    const url = input.section === 'discover' ? (input.feed === 'popular' ? 'https://www.bilibili.com/v/popular/all' : 'https://www.bilibili.com/') : `https://www.bilibili.com/video/${input.bvid}/`;
    const opened = z.object({ url: z.string(), challenge: z.object({ blocked: z.boolean(), kind: z.string().max(40).optional() }).optional() }).parse(await call('dsh_browser_open', { url }, signal));
    const verifyUrl = (value) => { const actual = new URL(value); if (actual.origin !== 'https://www.bilibili.com' || actual.pathname !== new URL(url).pathname)
        throw new Error('BILI_BROWSER_REDIRECT'); };
    verifyUrl(opened.url);
    if (opened.challenge?.blocked && opened.challenge.kind !== 'generic')
        throw new Error('BILI_BROWSER_CHALLENGE');
    // One shared budget after navigation. Poll only the existing DOM, never reload or retry an API request.
    const deadline = clock.now() + readinessMs, readySignal = AbortSignal.any([signal, AbortSignal.timeout(readinessMs)]);
    const waitReady = async (read, code) => {
        try {
            for (;;) {
                signal.throwIfAborted();
                readySignal.throwIfAborted();
                if (clock.now() >= deadline)
                    throw new Error(code);
                const value = await read();
                signal.throwIfAborted();
                readySignal.throwIfAborted();
                if (clock.now() >= deadline)
                    throw new Error(code);
                if (value !== null)
                    return value;
                await clock.wait(Math.min(pollMs, deadline - clock.now()), readySignal);
            }
        }
        catch (error) {
            signal.throwIfAborted();
            if (readySignal.aborted)
                throw new Error(code);
            throw error;
        }
    };
    const verify = () => waitReady(async () => {
        const state = z.object({ url: z.string(), ids: z.array(z.string().regex(/^[1-9]\d{0,19}$/)).max(20) }).parse(evaluated(await call('dsh_browser_execute', { script: identityScript }, readySignal)));
        verifyUrl(state.url);
        if (state.ids.some(id => id !== expectedUid))
            throw new Error('BILI_BROWSER_ACCOUNT_MISMATCH');
        return state.ids.length ? true : null;
    }, 'BILI_BROWSER_IDENTITY_UNAVAILABLE');
    const checkReportedChallenge = async () => {
        if (!opened.challenge?.blocked)
            return;
        try {
            await waitReady(async () => {
                const evidence = z.object({ normalVideo: z.boolean(), widget: z.boolean(), outsideVerificationText: z.boolean(), contentVerificationText: z.boolean() }).parse(evaluated(await call('dsh_browser_execute', { script: contentChallengeCheck }, readySignal)));
                if (evidence.widget || evidence.outsideVerificationText)
                    throw new Error('BILI_BROWSER_CHALLENGE');
                return evidence.normalVideo && evidence.contentVerificationText ? true : null;
            }, 'BILI_BROWSER_CHALLENGE');
        }
        catch {
            signal.throwIfAborted();
            throw new Error('BILI_BROWSER_CHALLENGE');
        }
    };
    await checkReportedChallenge();
    await verify();
    if (input.section === 'comments')
        await waitReady(async () => { await call('dsh_browser_scroll', { deltaY: 850 }, readySignal); return true; }, 'BILI_BROWSER_CONTENT_UNAVAILABLE');
    const content = await waitReady(async () => {
        const value = evaluated(await call('dsh_browser_execute', { script: input.section === 'comments' ? commentsScript : input.section === 'discover' ? (input.feed === 'popular' ? discoverScript : homeDiscoverScript) : input.section === 'frame' ? frameScript(input.positionMs) : videoScript }, readySignal));
        if (value === null)
            return null;
        const failure = z.object({ error: z.enum(['BILI_RESTRICTED_MEDIA', 'BILI_BROWSER_POSITION_UNAVAILABLE', 'BILI_BROWSER_FRAME_UNAVAILABLE']) }).safeParse(value);
        if (failure.success)
            throw new Error(failure.data.error);
        const parsed = z.object({ title: z.string().max(300), text: z.string().max(5000), truncated: z.boolean(), frame: BiliBrowserFrameSchema.optional() }).parse(value);
        if (input.section === 'frame' && !parsed.frame)
            throw new Error('BILI_BROWSER_FRAME_UNAVAILABLE');
        return parsed.text.trim() ? parsed : null;
    }, 'BILI_BROWSER_CONTENT_UNAVAILABLE');
    await verify();
    await checkReportedChallenge();
    return BiliBrowserResultSchema.parse({ transport: 'dsh-browser', accountUid: expectedUid, bvid: input.bvid ?? null, section: input.section, ...(input.section === 'discover' ? { feed: input.feed ?? 'home' } : {}), url, title: redactContent(content.title).value, text: redactContent(content.text).value, truncated: content.truncated, observedAt: new Date().toISOString(), ...(content.frame ? { frame: content.frame } : {}) });
}
