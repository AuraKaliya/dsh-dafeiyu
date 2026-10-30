import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

import { ContextBudgetSchema } from '@dafeiyu/contracts';
import { RuntimeStore, runtimeHash } from '../packages/core/lib/runtime-store.js';
import { ExecutionCoordinator } from '../packages/core/lib/execution-coordinator.js';
import { testTempDir } from './test-temp.js';

const terminal = ['completed', 'waiting', 'failed', 'cancelled', 'interrupted'];
const hash = (seed: string) => createHash('sha256').update(seed).digest('hex');
const foundation = { version: hash('foundation'), identity: hash('identity') };

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

async function harness(options: { runExecution?: (frame: any) => Promise<unknown>; blocking?: boolean } = {}) {
  const root = await mkdtemp(join(testTempDir(), 'coordinator-'));
  const store = new RuntimeStore(join(root, 'runtime.sqlite'), { agentId: 'fish', profileId: 'test' }, { create: true });
  const repository = taskRepository();
  const model = { provider: 'deepseek-official', model: 'deepseek-flash' };
  const memoryPort = options.blocking ? {
    ready: () => true, acceptIntent: () => undefined, prepareContext: () => [],
    intent: () => ({ blocking: true, requiredCapabilities: [], next: 'wait' }), validate: () => true,
  } : undefined;
  const personaRuntime = {
    prepare: (run: { id: string }, snapshot: { version: string }) => ({
      projectionKey: hash('projection'),
      manifest: {
        schemaVersion: 1, agentId: 'fish', runId: run.id, foundationHash: snapshot.version, foundationIdentity: foundation.identity,
        stageRevision: 0, selectionVersion: 0, stageStatus: 'empty', omittedCandidates: 0, entries: [], continuityCheckpointId: null,
        policyVersion: hash('policy'), modelRouteHash: runtimeHash(model),
      },
      items: [],
      guard: () => undefined,
      dispose: () => undefined,
    }),
    access: (run: any, inputs: any, signal: AbortSignal, guard: () => void) => (personaRuntime as any).enrich({
      view: Object.freeze({ runId: run.id, taskId: run.definition.taskId, scope: run.definition.scope, origin: run.definition.origin, signal }),
      guard, motivation: { kind: 'explicit-task', basis: ['fixture'] },
    }, run),
    enrich: (access: unknown) => access,
  };
  const coordinator = new ExecutionCoordinator({
    agentId: 'fish', store,
    journal: new Proxy({}, {
      get: (_target, key) => key === 'get' ? (() => { throw new Error('NO_JOURNAL'); })
        : key === 'list' || key === 'executionEvents' ? (() => [])
          : key === 'messageRecalled' ? (() => false)
            : (() => undefined),
    }) as never,
    runtime: { runExecution: options.runExecution ?? (async (frame: any) => ({ text: 'done', resultRef: { sessionId: frame.sessionId, messageSeq: 1, turnEndSeq: 2, textHash: hash('result') } })) },
    registry: { actions: () => [], contributors: () => [] },
    scheduler: { acquireHandle: async () => ({ close() {} }) },
    channelDescription: () => '', experience: () => undefined,
    options: { profileId: 'test', createStore: false, policies: [{ id: 'fixture-task', producers: ['fixture'], actions: [], allowLocalWrite: false, sourceRules: [], resources: [] }], maxPendingRuns: 100, maxConcurrentRuns: 2 },
    repository: () => repository, personas: personaRuntime as never, memory: () => memoryPort as never,
    accepting: () => true, assertAccepting: () => undefined,
    persona: () => ({ version: foundation.version, hash: foundation.identity, fileIdentity: hash('file'), text: 'persona' }),
    model, turnTimeoutMs: 60_000,
    context: ContextBudgetSchema.parse({}),
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
    assert.equal(state, 'completed', 'state=' + state + ' error=' + String(store.get((run as unknown as { id: string }).id).error));
  } finally {
    store.close();
  }
});

test('an executor exception fails the run without leaving it running', async () => {
  const { coordinator, store } = await harness({ runExecution: async () => { throw new Error('BOOM'); } });
  try {
    const producer = coordinator.producer('fixture');
    const { run } = producer.submitTask({ requestId: randomUUID(), title: '读取失败', goal: '观察失败路径', policyId: 'fixture-task' });
    coordinator.activate();
    const state = await waitTerminal(store, (run as unknown as { id: string }).id);
    assert.equal(state, 'failed');
  } finally {
    store.close();
  }
});

test('a blocking intent parks the run in waiting with a checkpoint', async () => {
  const { coordinator, store } = await harness({ blocking: true });
  try {
    const producer = coordinator.producer('fixture');
    const { run } = producer.submitTask({ requestId: randomUUID(), title: '等待确认', goal: '需要主人确认', policyId: 'fixture-task' });
    coordinator.activate();
    const id = (run as unknown as { id: string }).id;
    const state = await waitTerminal(store, id);
    assert.equal(state, 'waiting');
  } finally {
    store.close();
  }
});

test('cancelling before the executor starts reaches cancelled without running', async () => {
  const { coordinator, store } = await harness();
  try {
    const producer = coordinator.producer('fixture');
    const { run } = producer.submitTask({ requestId: randomUUID(), title: '取消', goal: '取消路径', policyId: 'fixture-task' });
    const id = (run as unknown as { id: string }).id;
    producer.cancel(run, { requestId: randomUUID(), expectedVersion: store.get(id).version, reason: 'test-cancel' });
    coordinator.activate();
    const state = await waitTerminal(store, id);
    assert.equal(state, 'cancelled');
  } finally {
    store.close();
  }
});

test('the declared tool stage reaches the execution frame', async () => {
  const frames: any[] = [];
  const capture = async (frame: any) => {
    frames.push(frame);
    return { text: 'done', resultRef: { sessionId: frame.sessionId, messageSeq: 1, turnEndSeq: 2, textHash: hash('result') } };
  };
  const reading = await harness({ runExecution: capture });
  try {
    const producer = reading.coordinator.producer('fixture');
    const { run } = producer.submitTask({ requestId: randomUUID(), title: '阅读', goal: '读完汇报', policyId: 'fixture-task', data: { toolStage: 'bili-reading' } });
    reading.coordinator.activate();
    await waitTerminal(reading.store, (run as unknown as { id: string }).id);
    assert.equal(frames[0]?.toolStage, 'bili-reading');
  } finally { reading.store.close(); }

  const plain = await harness({ runExecution: capture });
  try {
    const producer = plain.coordinator.producer('fixture');
    const { run } = producer.submitTask({ requestId: randomUUID(), title: '普通', goal: '普通任务', policyId: 'fixture-task' });
    plain.coordinator.activate();
    await waitTerminal(plain.store, (run as unknown as { id: string }).id);
    assert.equal(frames[1]?.toolStage, 'general');
  } finally { plain.store.close(); }
});

test('a yielded segment hands off to a child run instead of completing', async () => {
  let calls = 0;
  const { coordinator, store } = await harness({
    runExecution: async (frame: any) => {
      calls += 1;
      const resultRef = { sessionId: frame.sessionId, messageSeq: calls, turnEndSeq: calls + 1, textHash: hash('result' + calls) };
      return calls === 1 ? { text: '', resultRef, segmentYield: { reason: 'hard-limit' } } : { text: 'done', resultRef };
    },
  });
  try {
    const producer = coordinator.producer('fixture');
    const { run } = producer.submitTask({ requestId: randomUUID(), title: '长任务', goal: '读完再汇报', policyId: 'fixture-task' });
    const id = (run as unknown as { id: string }).id;
    coordinator.activate();
    assert.equal(await waitTerminal(store, id), 'continued');
    const parent = store.get(id), child = store.list().find(candidate => candidate.definition.parentRunId === id);
    assert.ok(child, 'expected a child segment');
    assert.equal(child!.definition.taskId, parent.definition.taskId);
    assert.notEqual(child!.snapshot?.sessionId, parent.snapshot?.sessionId);
    assert.equal(store.nativeDeliveryCandidates().includes(id), false);
    coordinator.activate();
    assert.equal(await waitTerminal(store, child!.id), 'completed');
  } finally { store.close(); }
});
