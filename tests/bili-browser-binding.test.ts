import assert from 'node:assert/strict';
import test from 'node:test';

import { browserBindingMatches } from '../packages/bilibili/lib/client.js';

const base = { transport: 'dsh-browser' as const, observedAt: '2026-10-31T00:00:00.000Z', accountUid: '42', title: '标题', text: '', truncated: false };
const search = { ...base, section: 'search' as const, url: 'https://search.bilibili.com/all?keyword=%E7%8C%AB', bvid: null,keyword:'猫',order:'totalrank' as const,page:1 };
const video = { ...base, section: 'video' as const, url: 'https://www.bilibili.com/video/BV1xNpFedEwH/', bvid: 'BV1xNpFedEwH' };

test('a valid search page is not forced through the video target rule', () => {
  assert.equal(browserBindingMatches({ taskId: 't', runId: 'r', operationId: 'o', section: 'search', keyword: '猫', order: 'totalrank', page: 1 }, search, '42'), true);
});

test('search results still reject a mismatched account or a non-search URL', () => {
  assert.equal(browserBindingMatches({ taskId: 't', runId: 'r', operationId: 'o', section: 'search', keyword: '猫', order: 'totalrank', page: 1 }, search, '43'), false);
  assert.equal(browserBindingMatches({ taskId: 't', runId: 'r', operationId: 'o', section: 'search', keyword: '猫', order: 'totalrank', page: 1 }, { ...search, url: 'https://www.bilibili.com/' }, '42'), false);
});

test('video targets keep their existing binding rules', () => {
  assert.equal(browserBindingMatches({ taskId: 't', runId: 'r', operationId: 'o', section: 'video', bvid: 'BV1xNpFedEwH' }, video, '42'), true);
  assert.equal(browserBindingMatches({ taskId: 't', runId: 'r', operationId: 'o', section: 'video', bvid: 'BV1xNpFedEwH' }, { ...video, bvid: 'BV1WqpS66E7w' }, '42'), false);
});

test('search identity checks the actual query, order and page instead of only the domain',()=>{
  const request={taskId:'t',runId:'r',operationId:'o',section:'search' as const,keyword:'猫',order:'totalrank' as const,page:1};
  for(const url of ['https://search.bilibili.com/all?keyword=dog','https://search.bilibili.com/all?keyword=%E7%8C%AB&page=2','https://search.bilibili.com/all?keyword=%E7%8C%AB&order=click'])
    assert.equal(browserBindingMatches(request,{...search,url},'42'),false);
});
