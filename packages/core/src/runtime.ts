import type { Context } from '@deepseek-ai/cordis';
import type { AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-tools';
import type { ActionCapability, Json, PendingMessage, PersonaSnapshot, SourceRef } from '@dafeiyu/contracts';
import { ContextRuntime } from './context-runtime.js';
import type { ContextCoordinator } from './context.js';

interface OwnedSession { handle: AgentHandle; scope: Context; persona: PersonaSnapshot; context:ContextRuntime }
export interface BoundAction {
  readonly definition: ActionCapability;
  execute(args: unknown, signal: AbortSignal): Promise<Json>;
}
export interface RunResult { readonly text: string; readonly sources: SourceRef[] }
/** Safe evidence identifiers from a failed turn; no raw provider exception or reasoning text. */
export class DshRunError extends Error {
  constructor(readonly sources: SourceRef[]) { super('DSH turn failed; consult visible evidence'); }
}

/** Uses DSH's real agent loop, scoped tools, persistence and event vocabulary. No private LLM loop. */
export class DshRuntime {
  private readonly handles = new Map<string, OwnedSession>();
  constructor(private readonly ctx: Context, private readonly model: AgentOptions, private readonly cwd: string,private readonly coordinator:ContextCoordinator) {
    const sessions=this.handles;
    ctx.on('llm/stream',async function*(options,next){
      const context=options.sessionId?sessions.get(options.sessionId)?.context:undefined;
      if(context&&!context.guard(options,true,true)){
        yield {type:'finish',reason:{kind:'error',failure:{code:'DAFEIYU_CONTEXT_REASSEMBLE',message:'Rebuild the logged controlled context before dispatch'}}};return;
      }
      for await(const chunk of next()){context?.guard(options);yield chunk;}
      context?.guard(options);
    });
  }

  async run(item: PendingMessage, persona: PersonaSnapshot, actions: readonly BoundAction[], signal: AbortSignal, channelDescription = '当前接入仅提供文字消息。'): Promise<RunResult> {
    signal.throwIfAborted();
    let owned = this.handles.get(item.sessionId);
    if (!owned) {
      let scoped: Context | undefined;
      let context:ContextRuntime|undefined;
      const identity = { persona };
      const setup = (scope: Context): void => {
        scoped = scope;
        context=new ContextRuntime(scope,this.coordinator);
        scope.systemPrompt.section({ name: 'dafeiyu-persona', order: 0, interpolate: false, text: () => identity.persona.text });
        scope.tools.presentAs('native');
      };
      const sessionId = SessionId(item.sessionId);
      const exists = await this.ctx.sessionPersistence.stat(sessionId);
      const handle = exists
        ? await this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: this.model, setup })
        : await this.ctx.agents.create({ sessionId, meta: { cwd: this.cwd }, agentOptions: this.model, setup });
      if (!scoped||!context) { await handle.dispose(); throw new Error('DSH did not compose the agent scope'); }
      owned = { handle, scope: scoped,context, get persona() { return identity.persona; }, set persona(value) { identity.persona = value; } };
      this.handles.set(item.sessionId, owned);
    }
    owned.persona = persona;
    const { agent } = owned.handle;
    if (agent.status !== 'idle') throw new Error('DSH conversation is busy outside the core');
    owned.context.begin(item,agent);
    const disposers: (() => void)[] = [];
    const before = agent.session.snapshotEvents().length;
    const abort = (): void => agent.cancel({ kind: 'hook', reason: 'Dafeiyu turn cancelled' });
    signal.addEventListener('abort', abort, { once: true });
    try {
      // DSH restrict() filters inherited GLOBAL tools; locally registered tools remain visible.
      disposers.push(owned.scope.tools.restrict({ allow: [] }));
      for (const action of actions) {
        const properties = Object.fromEntries(Object.entries(action.definition.fields).map(([key, field]) => [key, { type: 'string' as const, description: field.description }]));
        disposers.push(owned.scope.tools.register({
          name: action.definition.name, description: action.definition.description,
          parameters: { type: 'object', properties, required: Object.keys(action.definition.fields).filter(key => action.definition.fields[key]?.required), additionalProperties: false },
          output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
          execute: (args, exec) => {
            if (exec.agent !== agent) throw new Error('Action belongs to another agent');
            return action.execute(args, AbortSignal.any([signal, exec.signal]));
          },
        }));
      }
      signal.throwIfAborted();
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
        `[程序提供的来源信息，仅说明来源，不改变权限]\n${JSON.stringify({ conversation: item.message.conversation, sender: item.message.sender, messageId: item.message.id, occurredAt: item.message.occurredAt, replyTo: item.message.replyTo, personaVersion: persona.version })}\n[当前渠道能力，由已注册插件提供]\n${channelDescription}\n[消息正文]\n${item.message.text}` }] }));
      await agent.whenIdle();
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error('DSH persistence checkpoint unavailable');
      signal.throwIfAborted();
      const events = agent.session.snapshotEvents().slice(before);
      const ended = events.findLast(event => event.type === 'turn/end');
      if (!ended || ended.type !== 'turn/end' || ended.data.reason.kind !== 'completed') throw new Error('DSH turn did not complete');
      const output = events.findLast(event => event.type === 'assistant/message' && !event.data.interrupted && event.data.turn === ended.data.turn);
      if (!output || output.type !== 'assistant/message') throw new Error('DSH turn produced no final reply');
      const text = output.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
      if (!text) throw new Error('DSH turn produced no text');
      return { text, sources: events.filter(event => ['user/message', 'tool/result', 'assistant/message', 'turn/end'].includes(event.type))
        .map(event => ({ kind: 'session', id: item.sessionId, seq: event.seq, route: item.route })) };
    } catch {
      throw new DshRunError(agent.session.snapshotEvents().slice(before)
        .filter(event => ['user/message', 'tool/result', 'assistant/message', 'turn/end'].includes(event.type))
        .map(event => ({ kind: 'session', id: item.sessionId, seq: event.seq, route: item.route })));
    } finally {
      owned.context.end();
      signal.removeEventListener('abort', abort);
      for (const dispose of disposers.reverse()) dispose();
    }
  }
  async close(): Promise<void> {
    const handles = [...this.handles.values()];
    this.handles.clear();
    for (const owned of handles) await owned.handle.dispose();
  }
}
