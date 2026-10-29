import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type {} from '@dafeiyu/channel-simulator';
import { testTempDir } from '../test-temp.js';

test('offline Host connects Core, memory, registered tools and one simulator reply', async t => {
  const root = await mkdtemp(join(testTempDir(), 'host-smoke-'));
  const file = join(root, 'host.json'), coordination = join(root, 'coordination.sqlite');
  // Host binds the DSH home at import time. Everything belongs to this managed test run.
  process.env.DSH_HOME = join(root, 'data/core/dsh-home');
  const { ManagedHost, loadHostConfig, initializeProfile } = await import('@dafeiyu/host');
  const config = {
    schemaVersion: 1, profileId: 'smoke', agent: { id: 'dafeiyu' },
    paths: { core: './data/core', memory: './data/memory', sessions: './data/sessions', query: './data/query.sqlite' },
    modelRoutes: { chat: { provider: 'local-test', model: 'scripted' } },
    persona: { fixedFile: './persona.md', kind: 'test' },
    plugins: [
      { id: 'model-scripted', required: true, config: { response: '本机装配检查' } },
      { id: 'timeline', required: true, config: { execution: true } },
      { id: 'memory-growth', required: true },
      { id: 'channel-simulator', config: { account: 'smoke' } },
    ],
    authorityPolicies: [{ id: 'local', producers: ['host-cli'], actions: [], allowLocalWrite: false }],
  };
  await writeFile(join(root, 'persona.md'), '本机虚构底色。');
  await writeFile(file, JSON.stringify(config));
  const prepared = loadHostConfig(file);
  initializeProfile(prepared, coordination);
  const host = await ManagedHost.start(prepared, { coordination });
  t.after(() => host.close());
  assert.equal(host.snapshot().phase, 'ready');
  assert.ok(host.snapshot().plugins.some(plugin => plugin.id === 'memory' && plugin.state === 'ready'));
  const actions = host.core.capabilityManifest().actions;
  assert.ok(actions.some(action => action.owner === 'memory'));
  assert.ok(actions.some(action => action.id === 'dafeiyu_task_intent'));
  host.ctx.dafeiyuSimulator.send('room', '虚构输入', { id: 'smoke-message' });
  await host.core.whenIdle();
  assert.equal(host.ctx.dafeiyuSimulator.deliveries.length, 1);
  assert.equal(host.ctx.dafeiyuSimulator.deliveries[0]?.text, '本机装配检查');
});
