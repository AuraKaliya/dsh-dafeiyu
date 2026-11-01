import assert from 'node:assert/strict';
import test from 'node:test';

import { BILI_READING_ACTIONS } from '../packages/core/lib/harness-runtime.js';
import { BILI_ACTIONS } from '../packages/bilibili/lib/service.js';

test('the reading stage keeps read-only host discovery but excludes host dispatch and writes', () => {
  for (const allowed of ['bili_search', 'bili_video', 'bili_comments', 'bili_subtitles', 'bili_frames', 'bili_reading_save', 'dafeiyu_media_read', 'dafeiyu_execution_source_open', 'dafeiyu_task_outcome', 'dsh_tool_list'])
    assert.ok(BILI_READING_ACTIONS.has(allowed), allowed);
  for (const denied of ['dsh_tool_call', 'dsh_browser_open', 'qq_send_message', 'dafeiyu_media_acquire', 'dsh_shell', 'dsh_write_file'])
    assert.ok(!BILI_READING_ACTIONS.has(denied), denied);
});

test('batch frames are authorized and the optional browser tool is added by installation', () => {
  assert.ok(BILI_ACTIONS.includes('bili_frames'));
  assert.ok(BILI_READING_ACTIONS.has('bili_browser_read'));
  assert.ok(!(BILI_ACTIONS as readonly string[]).includes('bili_browser_read'));
  assert.ok(BILI_ACTIONS.includes('bili_reading_save'));
});
