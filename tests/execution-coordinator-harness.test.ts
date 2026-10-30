import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

import { RuntimeStore } from '../packages/core/lib/runtime-store.js';
import { ExecutionCoordinator } from '../packages/core/lib/execution-coordinator.js';
import { testTempDir } from './test-temp.js';

const terminal = ['completed', 'waiting', 'failed', 'cancelled', 'interrupted'];

/** Minimal TaskRepositoryPort: one active task per create, versions advance on update. */
function taskRepository() {
  const tasks = new Map<string, { id: string; agentId: string; version: number; epoch: number; status: 'active' | 'paused' | 'completed'; title: string; goal: string }>();
  return {
    tasks,
    ready: () => true,
    create: (agentId: string, input: { title: string; goal: string }) => {
      const id = randomUUID();
      tasks.set(id, { id, agentId, version: 1, epoch: 1, status: 'active', title: input.title, goal: input.goal });
      return id;
    },
    findRequest: () => null,
    readState: (agentId: string, id: string) => {
      const task = tasks.get(id);
      if (!task || task.agentId !== agentId) throw new Error('TASK_NOT_FOUND');
      return task;
    },
    readSelectedInputs: () => [],
    update: (_agentId: string, id: string, input: Record<string, unknown>) => {
      const task = tasks.get(id)!;
      const next = { ...task, ...input, version: task.version + 1 } as typeof task;
      tasks.set(id, next);
      return next;
    },
  };
}

async function harness(options: { runExecution?: () => Promise<unknown> } = {}) {
  const root = await mkdtemp(join(testTempDir(), 'coordinator-'));
  const store = new RuntimeStore(join(root, 'runtime.sqlite'), { agentId: 'fish', profileId: 'test' }, { create: true });
  const repository = taskRepository();
  const coordinator = new ExecutionCoordinator({
    agentId: 'fish', store, journal: new Proxy({}, { get: (_target, key) => key === 'get' ? (() => { throw new Error('NO_JOURNAL'); }) : key === 'list' || key === 'executionEvents' ? (() => []) : key === 'messageRecalled' ? (() => false) : (() => undefined) }) as never,
    runtime: { runExecution: options.runExecution ?? (async () => ({ text: 'done', resultRef: { sessionId: 's1', messageSeq: 1, turnEndSeq: 2, textHash: 'h' } })) },
    registry: { actions: () => [], contributors: () => [] },
    scheduler: { acquireHandle: async () => ({ close() {} }) },
    channelDescription: () => '', experience: () => undefined,
    options: { profileId: 'test', createStore: false, policies: [{ id: 'fixture-task', producers: ['fixture'], actions: [], allowLocalWrite: false, sourceRules: [], resources: [] }], maxPendingRuns: 100, maxConcurrentRuns: 2 },
    repository: () => repository, personas: { access: () => ({}), items: () => [] }, memory: () => undefined,
    accepting: () => true, assertAccepting: () => undefined,
    persona: () => ({ version: 'fixture', hash: 'h', fileIdentity: 'f', text: 'persona' }),
    model: { provider: 'deepseek-official', model: 'deepseek-flash' }, turnTimeoutMs: 60_000,
    context: { requestMaxBytes: 1_000_000, outputReserveBytes: 16_000, regions: {} },
    signal: new AbortController().signal,
  } as never);
  return { coordinator, store, repository };
}

async function waitTerminal(store: RuntimeStore, id: string) {
  for (let step = 0; step < 200; step += 1) {
    const state = store.get(id).state;
    if (terminal.includes(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return store.get(id).state;
}

test('a submitted task run reaches a terminal state and never stays running', async () => {
  const { coordinator, store } = await harness();
  try {
    const producer = coordinator.producer('fixture');
    const { run } = producer.submitTask({ requestId: randomUUID(), title: '读取一个视频', goal: '看完后汇报', policyId: 'fixture-task' });
    coordinator.activate();
    const state = await waitTerminal(store, (run as unknown as { id: string }).id);
    assert.notEqual(state, 'running', 'a run that left the executor must not stay running');
    assert.ok(terminal.includes(state), 'state=' + state + ' error=' + String(store.get((run as unknown as { id: string }).id).error));
    assert.ok(terminal.includes(state), `unexpected state ${state}`);
  } finally {
    store.close();
  }
});
