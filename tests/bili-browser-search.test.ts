import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readBiliBrowser } from '../packages/plugin/lib/bili-browser.js';
import type { BrowserReadinessClock, BrowserToolCall } from '../packages/plugin/lib/bili-browser.js';
import { BiliBrowserRequestSchema } from '@dafeiyu/contracts';
import type { BiliBrowserRequest } from '@dafeiyu/contracts';

const result = (value: unknown) => ({ ok: true, value: JSON.stringify(value) });
const isIdentity = (args: Record<string, unknown>) => String(args.script).includes('space.bilibili.com');
const request = (over: Partial<BiliBrowserRequest> = {}): BiliBrowserRequest => ({
  taskId: randomUUID(), runId: randomUUID(), operationId: randomUUID(), section: 'search', keyword: '养鱼', order: 'click', page: 1, ...over,
});
function clock(): BrowserReadinessClock { let elapsed = 0; return { now: () => elapsed, wait: async () => { elapsed += 250; } }; }

test('search reads require a keyword and reject a video identifier', () => {
  assert.equal(BiliBrowserRequestSchema.parse({ taskId: randomUUID(), runId: randomUUID(), operationId: randomUUID(), section: 'search', keyword: '养鱼' }).keyword, '养鱼');
  assert.throws(() => BiliBrowserRequestSchema.parse({ taskId: randomUUID(), runId: randomUUID(), operationId: randomUUID(), section: 'search' }), /keyword/i);
  assert.throws(() => BiliBrowserRequestSchema.parse({ taskId: randomUUID(), runId: randomUUID(), operationId: randomUUID(), section: 'search', keyword: '养鱼', bvid: 'BV1xNpFedEwH' }), /omit/i);
  assert.throws(() => BiliBrowserRequestSchema.parse({ taskId: randomUUID(), runId: randomUUID(), operationId: randomUUID(), section: 'video', bvid: 'BV1xNpFedEwH', keyword: '养鱼' }), /Only search/i);
});

test('browser search opens the search page and returns structured candidates', async () => {
  const url = 'https://search.bilibili.com/all?keyword=%E5%85%BB%E9%B1%BC&order=click&page=1';
  const calls: string[] = [];
  const call: BrowserToolCall = async (name, args) => {
    calls.push(name);
    if (name === 'dsh_browser_open') {
      assert.equal(args.url, url);
      return { url, challenge: { blocked: false } };
    }
    if (isIdentity(args)) return result({ url, ids: ['42'] });
    return result({ title: 'B站搜索结果', text: '搜索页已加载 2 条', truncated: false, items: [{ bvid: 'BV1xNpFedEwH', title: '养鱼 第一年', author: 'UP甲' }, { bvid: 'BV1WqpS66E7w', title: '我想给她完整的一生' }] });
  };
  const value = await readBiliBrowser(request(), '42', call, new AbortController().signal, clock());
  assert.equal(value.section, 'search');
  assert.equal(value.keyword, '养鱼');
  assert.equal(value.order, 'click');
  assert.equal(value.page, 1);
  assert.equal(value.items?.length, 2);
  assert.equal(value.items?.[0]?.author, 'UP甲');
  assert.equal(value.items?.[1]?.author, '');
  assert.equal(calls.filter(name => name === 'dsh_browser_open').length, 1);
});

test('browser search rejects a page outside the search origin', async () => {
  const call: BrowserToolCall = async (name) => name === 'dsh_browser_open' ? { url: 'https://www.bilibili.com/', challenge: { blocked: false } } : result({ url: 'https://www.bilibili.com/', ids: ['42'] });
  await assert.rejects(readBiliBrowser(request(), '42', call, new AbortController().signal, clock()), /BILI_BROWSER_REDIRECT/);
});

test('an explicit empty search is distinct from a page that has not loaded',async()=>{
  const url='https://search.bilibili.com/all?keyword=%E5%85%BB%E9%B1%BC&order=click&page=1';
  const call=(empty:boolean):BrowserToolCall=>async(name,args)=>{
    if(name==='dsh_browser_open')return {url,challenge:{blocked:false}};
    if(isIdentity(args))return result({url,ids:['42']});
    return result({title:'搜索结果',text:'没有相关结果',truncated:false,items:[],empty});
  };
  assert.deepEqual((await readBiliBrowser(request(),'42',call(true),new AbortController().signal,clock())).items,[]);
  await assert.rejects(readBiliBrowser(request(),'42',call(false),new AbortController().signal,clock()),/CONTENT_UNAVAILABLE/);
  await assert.rejects(readBiliBrowser(request({page:2}),'42',call(true),new AbortController().signal,clock()),/REDIRECT/);
});

test('browser discovery returns per-title candidates instead of one aggregate title', async () => {
  const url = 'https://www.bilibili.com/v/popular/all';
  const call: BrowserToolCall = async (name, args) => {
    if (name === 'dsh_browser_open') return { url, challenge: { blocked: false } };
    if (isIdentity(args)) return result({ url, ids: ['42'] });
    return result({ title: 'B站当前热门列表', text: '标题甲 https://www.bilibili.com/video/BV1xNpFedEwH/', truncated: false, items: [{ bvid: 'BV1xNpFedEwH', title: '标题甲' }] });
  };
  const value = await readBiliBrowser({ taskId: randomUUID(), runId: randomUUID(), operationId: randomUUID(), section: 'discover', feed: 'popular' } as BiliBrowserRequest, '42', call, new AbortController().signal, clock());
  assert.equal(value.items?.length, 1);
  assert.equal(value.items?.[0]?.bvid, 'BV1xNpFedEwH');
  assert.equal(value.items?.[0]?.author, '');
});
