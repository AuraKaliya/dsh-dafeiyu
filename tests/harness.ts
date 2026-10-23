import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime, { LlmAdapter, ToolCallId, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import * as Core from '@dafeiyu/core';
import * as Simulator from '@dafeiyu/channel-simulator';
import { resolve } from 'node:path';

export type Response = (request: GenerateOptions) => StreamChunk[] | Promise<StreamChunk[]>;
export function textReply(text: string): StreamChunk[] {
  return [ { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } } ];
}
export function call(name: string, args: object): StreamChunk[] {
  const id = ToolCallId(`call-${crypto.randomUUID()}`);
  return [ { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } },
    { type: 'finish', reason: { kind: 'tool-calls' } } ];
}
export class ScriptedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  constructor(private readonly response: Response) { super(); }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, systemPromptUpdate: 'in-history', toolUpdate: 'in-history',
      reasoning: { efforts: [{ id: ReasoningEffortId('max'), name: 'Max' }] } };
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    for (const chunk of await this.response(options)) { options.signal?.throwIfAborted(); yield chunk; }
  }
}
export async function harness(root: string, response: Response = () => textReply('测试回复'), personaFile = resolve('profiles/persona.test.md'), timeout = 5000, reasoningEffort?: string,context?:Core.Config['context']) {
  const ctx = new Context();
  const adapter = new ScriptedModel(response);
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(Projection);
    await ctx.plugin(Prompt);
    await ctx.plugin(Tools);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(Persistence, { root: resolve(root, 'sessions'), compression: 'none' });
    await ctx.plugin(AgentLoop, { agents: [] });
    ctx.llm.registerAdapter(['local-test'], adapter);
    const coreFiber = await ctx.plugin(Core, { agentId: 'dafeiyu', dataDir: root, personaFile,
      provider: 'local-test', model: 'scripted', turnTimeoutMs: timeout, ...(reasoningEffort ? { reasoningEffort } : {}),...(context?{context}:{}) });
    const simulatorFiber = await ctx.plugin(Simulator, { agentId: 'dafeiyu', account: 'local' });
    const core = ctx.dafeiyu;
    const simulator = ctx.dafeiyuSimulator;
    return { ctx, adapter, core, simulator, coreFiber, simulatorFiber,
      close: async () => { await simulatorFiber.dispose(); await coreFiber.dispose(); await ctx.fiber.dispose(); } };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
