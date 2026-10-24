import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { LlmAdapter, StreamChunk, GenerateOptions, UserMessage, ContextFormed } from '@deepseek-ai/dsh-llm';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dafeiyu-execution-probe': {
      kind: 'dafeiyu-execution-probe'; taskId: string; runId: string; inputId: string;
      originKind: 'native';
    } & ContextFormed;
  }
}

export interface ProbeRoute { provider: string; model: string; reasoningEffort?: string }
export interface StreamStats { reasoningBlocks: number; replayEnvelopes: number; toolBlocks: number }

/** Probe-only transport projection. No existing core or provider configuration is modified. */
export async function* visibleProbeStream(input: AsyncIterable<StreamChunk>, stats: StreamStats): AsyncIterable<StreamChunk> {
  const visible = new Map<number, { index: number; kind: 'text' | 'tool-call' }>();
  const seen = new Set<number>();
  for await (const chunk of input) {
    if (chunk.type === 'block-start') {
      if (seen.has(chunk.index)) throw new Error('PROBE_INVALID_STREAM');
      seen.add(chunk.index);
      if (chunk.blockType === 'reasoning') { stats.reasoningBlocks++; continue; }
      if (chunk.blockType !== 'text' && chunk.blockType !== 'tool-call') throw new Error('PROBE_UNSUPPORTED_BLOCK');
      const entry = { index: visible.size, kind: chunk.blockType };
      visible.set(chunk.index, entry);
      if (entry.kind === 'tool-call') stats.toolBlocks++;
      yield { type: 'block-start', index: entry.index, blockType: entry.kind };
    } else if (chunk.type === 'reasoning-delta') {
      continue;
    } else if (chunk.type === 'text-delta' || chunk.type === 'tool-call-delta') {
      const entry = visible.get(chunk.index);
      if (!entry || entry.kind !== (chunk.type === 'text-delta' ? 'text' : 'tool-call')) throw new Error('PROBE_INVALID_STREAM');
      if (chunk.type === 'text-delta') yield { type: 'text-delta', index: entry.index, text: chunk.text };
      else yield { type: 'tool-call-delta', index: entry.index, id: chunk.id,
        ...(chunk.name === undefined ? {} : { name: chunk.name }), argumentsDelta: chunk.argumentsDelta };
    } else if (chunk.type === 'block-end') {
      if (chunk.block.type === 'reasoning') continue;
      const entry = visible.get(chunk.index);
      if (!entry || chunk.block.type !== entry.kind) throw new Error('PROBE_INVALID_STREAM');
      if (chunk.block.type === 'text') yield { type: 'block-end', index: entry.index, block: { type: 'text', text: chunk.block.text } };
      else if (chunk.block.type === 'tool-call') yield { type: 'block-end', index: entry.index,
        block: { type: 'tool-call', id: chunk.block.id, name: chunk.block.name, arguments: chunk.block.arguments } };
    } else if (chunk.type === 'usage') {
      yield { type: 'usage', usage: chunk.usage };
    } else {
      if (chunk.replayState !== undefined) stats.replayEnvelopes++;
      yield { type: 'finish', reason: chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted'
        ? { kind: chunk.reason.kind, failure: { code: 'PROBE_PROVIDER_FAILED', message: 'Probe provider did not complete' } }
        : chunk.reason };
    }
  }
}

export function installProbeProjection(ctx: Context, sessionId: string, stats: StreamStats): void {
  ctx.on('llm/stream', async function* (options, next) {
    if (options.sessionId === sessionId) yield* visibleProbeStream(next(), stats);
    else yield* next();
  });
}

export function probeInput(taskId: string, runId: string, text: string): UserMessage {
  return createUserMessage({ source: { kind: 'dafeiyu-execution-probe', form: 'notice',
    summary: '本机虚构任务适配探针', taskId, runId, inputId: randomUUID(), originKind: 'native' },
    content: [{ type: 'text', text }] });
}

export async function probeHost(directory: string, adapter: LlmAdapter) {
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(Projection);
    await ctx.plugin(Prompt); await ctx.plugin(Tools); await ctx.plugin(AgentRegistry);
    await ctx.plugin(Persistence, { root: join(directory, 'sessions'), compression: 'none' });
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(Query, { path: join(directory, 'query.sqlite'), openAt: 'never' });
    ctx.llm.registerAdapter(['local-test'], adapter);
    return { ctx, close: () => ctx.fiber.dispose() };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}

/** Direct DSH probe; deliberately has no Dafeiyu core, channel or fake inbox record. */
export async function createProbeAgent(ctx: Context, route: ProbeRoute, id: string,
  onStep: (stage: number, proof: string) => string = stage => `probe-receipt-${stage}`, resume = false) {
  const setup = (scope: Context) => {
    scope.systemPrompt.section({ name: 'phase1-probe', order: 0, interpolate: false,
      text: '你正在执行本机隔离的适配验收。程序来源不是人类聊天。只使用实际工具结果，按任务要求调用工具；不要猜测回执。不要输出内部思考。' });
    scope.tools.presentAs('native'); scope.tools.restrict({ allow: [] });
    scope.tools.register({ name: 'phase1_probe_step', description: '本机虚构验收操作：按stage和proof返回真实测试回执，无外部副作用。',
      parameters: { type: 'object', properties: { stage: { type: 'integer' }, proof: { type: 'string' } }, required: ['stage', 'proof'], additionalProperties: false },
      output: { schema: {}, render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
      execute: async raw => { const input = z.strictObject({ stage: z.number().int().min(1).max(3), proof: z.string().max(500) }).parse(raw);
        return { receipt: onStep(input.stage, input.proof) }; } });
  };
  const agentOptions = { provider: route.provider, model: route.model,
    ...(route.reasoningEffort ? { reasoningEffort: ReasoningEffortId(route.reasoningEffort) } : {}) };
  return resume
    ? ctx.agents.resume({ resumeSessionId: SessionId(id), agentOptions, setup })
    : ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: process.cwd() }, agentOptions, setup });
}

export async function runProbeTurn(ctx: Context, handle: Awaited<ReturnType<typeof createProbeAgent>>, input: UserMessage, timeoutMs = 10000) {
  const before = handle.agent.session.snapshotEvents().length;
  const signal = AbortSignal.timeout(timeoutMs);
  const abort = () => handle.agent.cancel({ kind: 'hook', reason: 'Probe deadline reached' });
  signal.addEventListener('abort', abort, { once: true });
  try {
    handle.agent.followup(input); await handle.agent.whenIdle(); signal.throwIfAborted();
    if (!await ctx.sessions.flush(handle.agent.session)) throw new Error('PROBE_FLUSH_FAILED');
    const events = handle.agent.session.snapshotEvents().slice(before);
    const end = events.findLast(e => e.type === 'turn/end');
    if (!end || end.type !== 'turn/end' || end.data.reason.kind !== 'completed') throw new Error('PROBE_TURN_INCOMPLETE');
    const answer = events.findLast(e => e.type === 'assistant/message' && !e.data.interrupted && e.data.turn === end.data.turn);
    if (!answer || answer.type !== 'assistant/message') throw new Error('PROBE_ANSWER_MISSING');
    return { text: answer.data.message.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n'), events };
  } finally { signal.removeEventListener('abort', abort); }
}

export function containsPrivateModelState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsPrivateModelState);
  const object: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (object.type === 'reasoning' || Object.hasOwn(object, 'replayState')) return true;
  return Object.values(object).some(containsPrivateModelState);
}

export function countToolResults(request: GenerateOptions): number {
  return request.messages.filter(m => m.role === 'tool').length;
}
