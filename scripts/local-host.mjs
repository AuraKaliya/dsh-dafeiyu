import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key';
import * as Core from '@dafeiyu/core';
import * as Simulator from '@dafeiyu/channel-simulator';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import * as Timeline from '@dafeiyu/timeline';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';

export const model = Object.freeze({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' });
const fingerprint = async file => createHash('sha256').update(await readFile(file)).digest('hex');

/** Isolated DSH composition for local acceptance. Credential values never leave the DSH service. */
export async function localHost(root, { simulator = true, realModel = true, adapter, timeout = 180000, timeline = false, lifecycleMode = 'legacy', personaFile = resolve('profiles/persona.test.md') } = {}) {
  if (!process.env.DSH_HOME || resolve(process.env.DSH_HOME) !== resolve(root, 'dsh-home')) throw new Error('Isolated DSH_HOME must be selected before loading the host');
  const ctx = new Context();
  const calls = [];
  const faults = [];
  const credentialFile = join(homedir(), '.dsh', '.credentials.yaml');
  let credentialFingerprint;
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(Projection);
    await ctx.plugin(Prompt);
    await ctx.plugin(Tools);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(Persistence, { root: resolve(root, 'sessions'), compression: 'none' });
    await ctx.plugin(AgentLoop, { agents: [] });
    const queryFiber = timeline ? await ctx.plugin(Query, { path: resolve(root, 'history-index.sqlite'), openAt: 'never' }) : null;
    if (realModel) {
      // Fail before mounting the provider if its legacy migration might rewrite the user's store.
      const doc = parseDocument(await readFile(credentialFile, 'utf8'), { logLevel: 'silent' });
      if (doc.errors.length || doc.get('version') !== 1) throw new Error('Credential store must already use version 1; no migration performed');
      credentialFingerprint = await fingerprint(credentialFile);
      await ctx.plugin(Credentials, { path: credentialFile, watch: false });
      const description = await ctx.credentials.describe(credentialRef('DEEPSEEK_API_KEY'));
      if (!description.configured) throw new Error('Current DSH DeepSeek credential is not configured');
      await ctx.plugin(DeepSeek, { baseURL: 'https://api.deepseek.com/anthropic', apiKeyEnv: 'DEEPSEEK_API_KEY', reasoningEffort: 'max' });
    } else {
      if (!adapter) throw new Error('A scripted adapter is required in simulated-model mode');
      ctx.llm.registerAdapter(['local-test'], adapter);
    }
    ctx.on('llm/stream', async function* (options, next) {
      const entry = { at: new Date().toISOString(), provider: options.provider, model: options.model,
        reasoningEffort: options.reasoningEffort, sessionId: options.sessionId, durationMs: null, usage: null, status: 'running' };
      calls.push(entry); const start = Date.now();
      try {
        for await (const chunk of next()) { if (chunk.type === 'usage') entry.usage = chunk.usage;
          if(chunk.type==='finish'){entry.finish=chunk.reason.kind;if(chunk.reason.kind==='error'||chunk.reason.kind==='aborted')entry.status='failed';}
          yield chunk; }
        if(entry.status!=='failed')entry.status = 'completed';
      } catch (error) {
        entry.status = 'failed';
        // Keep only stable error classification; provider payloads may contain private material.
        faults.push({ code: typeof error?.code === 'string' ? error.code : 'MODEL_ERROR' });
        throw error;
      } finally { entry.durationMs = Date.now() - start; }
    });
    const coreFiber = await ctx.plugin(Core, { agentId: 'dafeiyu', dataDir: resolve(root, 'core'),
      personaFile, ...(realModel ? model : { provider: 'local-test', model: 'scripted' }),
      turnTimeoutMs: timeout,lifecycleMode });
    const simulatorFiber = simulator ? await ctx.plugin(Simulator, { agentId: 'dafeiyu', account: 'local' }) : null;
    const timelineFiber = timeline ? await ctx.plugin(Timeline, { agentId: 'dafeiyu' }) : null;
    let closed = false;
    return { ctx, core: ctx.dafeiyu, simulator: simulator ? ctx.dafeiyuSimulator : null, calls, faults,
      async close() {
        if (closed) return; closed = true;
        await simulatorFiber?.dispose(); await timelineFiber?.dispose(); await coreFiber.dispose(); await queryFiber?.dispose(); await ctx.fiber.dispose();
        if (credentialFingerprint && credentialFingerprint !== await fingerprint(credentialFile)) throw new Error('Credential store changed during acceptance');
      } };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
