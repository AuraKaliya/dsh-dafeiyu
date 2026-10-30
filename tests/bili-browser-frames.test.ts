import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readBiliBrowser } from '../packages/plugin/lib/bili-browser.js';
import type { BrowserReadinessClock, BrowserToolCall,BiliBrowserSession } from '../packages/plugin/lib/bili-browser.js';
import { BiliBrowserRequestSchema } from '@dafeiyu/contracts';
import type { BiliBrowserRequest } from '@dafeiyu/contracts';

const bvid = 'BV1xNpFedEwH';
const canonical = `https://www.bilibili.com/video/${bvid}/`;
const jpeg = 'data:image/jpeg;base64,/9j/2Q==';
const result = (value: unknown) => ({ ok: true, value: JSON.stringify(value) });
const isIdentity = (args: Record<string, unknown>) => String(args.script).includes('space.bilibili.com');
const isFrame = (args: Record<string, unknown>) => String(args.script).includes('toDataURL');
const request = (over: Partial<BiliBrowserRequest> = {}): BiliBrowserRequest => ({
  taskId: randomUUID(), runId: randomUUID(), operationId: randomUUID(), section: 'frames', bvid, pointsMs: [12000, 62000, 112000], ...over,
});
function clock(): BrowserReadinessClock { let elapsed = 0; return { now: () => elapsed, wait: async () => { elapsed += 250; } }; }
const at = (script: string) => Number(/const target=(\d+)\/1000/.exec(script)?.[1] ?? 0);

test('batch frame reads require a video and one to six points', () => {
  assert.equal(BiliBrowserRequestSchema.parse(request()).pointsMs?.length, 3);
  assert.throws(() => BiliBrowserRequestSchema.parse(request({ pointsMs: undefined })), /pointsMs/i);
  assert.throws(() => BiliBrowserRequestSchema.parse(request({ pointsMs: [] })), /pointsMs/i);
  assert.throws(() => BiliBrowserRequestSchema.parse(request({ bvid: undefined })), /pointsMs|bvid/i);
  assert.throws(() => BiliBrowserRequestSchema.parse(request({ positionMs: 1000 })), /pointsMs/i);
});

test('one navigation captures several points and keeps per-point results', async () => {
  const calls: string[] = [];
  const call: BrowserToolCall = async (name, args) => {
    calls.push(name);
    if (name === 'dsh_browser_open') return { url: canonical, challenge: { blocked: false } };
    if (isIdentity(args)) return result({ url: canonical, ids: ['42'] });
    if (isFrame(args)) return result({ url: canonical, title: '标题', text: '一帧', truncated: true, frame: { dataUrl: jpeg, positionMs: at(String(args.script)), durationMs: 180000 } });
    return result({ title: '标题', text: '简介', truncated: false });
  };
  const value = await readBiliBrowser(request(), '42', call, new AbortController().signal, clock());
  assert.equal(value.section, 'frames');
  assert.deepEqual(value.frames?.map(frame => frame.positionMs), [12000, 62000, 112000]);
  assert.equal(value.frameErrors?.length, 0);
  assert.equal(calls.filter(name => name === 'dsh_browser_open').length, 1);
});

test('a page change stops reuse and reports the remaining points as failures', async () => {
  const moved = `https://www.bilibili.com/video/BV1WqpS66E7w/`;
  const call: BrowserToolCall = async (name, args) => {
    if (name === 'dsh_browser_open') return { url: canonical, challenge: { blocked: false } };
    if (isIdentity(args)) return result({ url: canonical, ids: ['42'] });
    if (isFrame(args)) {
      const first = !String(args.script).includes('112000');
      return result({ url: first ? canonical : moved, title: '标题', text: '一帧', truncated: true, frame: { dataUrl: jpeg, positionMs: at(String(args.script)), durationMs: 180000 } });
    }
    return result({ title: '标题', text: '', truncated: false });
  };
  const value = await readBiliBrowser(request(), '42', call, new AbortController().signal, clock());
  assert.ok((value.frames?.length ?? 0) >= 1);
  assert.ok(value.frameErrors?.some(error => error.errorCode === 'BILI_BROWSER_PAGE_CHANGED'));
});

test('metadata and frames reuse a verified page but an account change stops reuse',async()=>{
  let opens=0,account='42';const session:BiliBrowserSession={};
  const call:BrowserToolCall=async(name,args)=>{
    if(name==='dsh_browser_open'){opens++;return {url:canonical};}
    if(isIdentity(args))return result({url:canonical,ids:[account]});
    if(String(args.script).includes('outsideVerificationText'))return result({normalVideo:true,widget:false,outsideVerificationText:false,contentVerificationText:false});
    if(isFrame(args))return result({url:canonical,title:'标题',text:'帧',truncated:true,frame:{dataUrl:jpeg,positionMs:at(String(args.script)),durationMs:180000}});
    return result({title:'标题',text:'简介',truncated:false});
  };
  const video=request({section:'video',pointsMs:undefined});
  await readBiliBrowser(video,'42',call,new AbortController().signal,clock(),session);
  const value=await readBiliBrowser(request(),'42',call,new AbortController().signal,clock(),session);
  assert.equal(opens,1);assert.equal(value.reused,true);assert.equal(value.frames?.length,3);
  account='99';await assert.rejects(readBiliBrowser(request(),'42',call,new AbortController().signal,clock(),session),/ACCOUNT_MISMATCH/);assert.equal(opens,1);
});

test('a point that never becomes ready times out without discarding earlier frames', async () => {
  const call: BrowserToolCall = async (name, args) => {
    if (name === 'dsh_browser_open') return { url: canonical, challenge: { blocked: false } };
    if (isIdentity(args)) return result({ url: canonical, ids: ['42'] });
    if (isFrame(args)) {
      const at = Number(/const target=(\d+)\/1000/.exec(String(args.script))?.[1] ?? 0);
      if (at === 62000) return result(null);
      return result({ url: canonical, title: '标题', text: '一帧', truncated: true, frame: { dataUrl: jpeg, positionMs: at, durationMs: 180000 } });
    }
    return result({ title: '标题', text: '', truncated: false });
  };
  const value = await readBiliBrowser(request(), '42', call, new AbortController().signal, clock());
  assert.deepEqual(value.frames?.map(frame => frame.positionMs), [12000, 112000]);
  assert.ok(value.frameErrors?.some(error => error.positionMs === 62000 && error.errorCode === 'BILI_BROWSER_POINT_TIMEOUT'));
});
