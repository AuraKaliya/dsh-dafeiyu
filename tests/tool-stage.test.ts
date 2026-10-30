import assert from 'node:assert/strict';
import test from 'node:test';

import { BILI_READING_STAGE, toolStage } from '../packages/core/lib/harness-runtime.js';

const action = (id: string) => ({ definition: { id } });

test('reading tasks derive the reading stage from Bilibili actions', () => {
  assert.equal(toolStage([]), 'general');
  assert.equal(toolStage([action('dsh_tool_call'), action('dafeiyu_media_read')]), 'general');
  assert.equal(toolStage([action('dsh_tool_call'), action('bili_search')]), BILI_READING_STAGE);
  assert.equal(toolStage([action('bili_frames'), action('bili_comments')]), BILI_READING_STAGE);
});

test('non-reading tasks keep the general stage even with media tools', () => {
  assert.equal(toolStage([action('dsh_tool_list'), action('dafeiyu_media_read')]), 'general');
});
