import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve('.runtime', 'phase2', 'model-' + randomUUID());
process.env.DSH_HOME = resolve(root, 'dsh-home');
const { localHost, model } = await import('./local-host.mjs');
await mkdir(root, { recursive: true });
const report = { stage: 'A', startedAt: new Date().toISOString(), model, checks: [], calls: [], faults: [], passed: false };
let host;
async function send(room, text, name, verify) {
  const receipt = host.simulator.send(room, text, { id: randomUUID(), occurredAt: new Date().toISOString() });
  await host.core.whenIdle();
  const item = host.core.journal.get(receipt.id);
  const reply = item.reply?.text ?? '';
  const passed = item.state === 'delivered' && verify(reply, item);
  report.checks.push({ name, passed, state: item.state, reply, sessionId: item.sessionId });
  console.log(JSON.stringify({ name, passed, state: item.state, reply }));
  if (!passed) throw new Error('Acceptance check failed: ' + name);
}
try {
  host = await localHost(root);
  host.core.registerExtension({ id: 'acceptance-echo', version: '0.1.0', apiVersion: 2, agentId: 'dafeiyu', actions: [{
    name: 'acceptance_echo', description: '原样返回text并附一个固定的验收回执，请以实际工具返回为准。',
    fields: { text: { description: '要回显的文字', required: true } },
    execute: async args => ({ text: args.text ?? '', receipt: 'echo-accepted-42' }),
  }] });
  await send('private-test', '请用一句中文介绍你是谁。', 'persona', reply => reply.includes('大肥鱼'));
  await send('private-test', '本轮测试约定：项目代号是“蓝帆731”。请记在当前会话中，并仅回复这个代号。', 'context-first', reply => reply.includes('蓝帆731'));
  await send('private-test', '更正刚才的约定：项目代号改为“青羽842”。仅回复新的代号。', 'context-correction', reply => reply.includes('青羽842') && !reply.includes('蓝帆731'));
  await send('private-test', '目前项目代号是什么？只回答代号。', 'context-recall', reply => reply.includes('青羽842') && !reply.includes('蓝帆731'));
  await send('group-test', '其他会话里约定的项目代号是什么？如果本会话没有相关信息，就回答“不知道”。不要调用工具。', 'scope-isolation', reply => reply.includes('不知道') && !/青羽842|蓝帆731/.test(reply));
  await send('private-test', '请实际调用 acceptance_echo，text填“本地验收”。然后只回答工具返回的receipt，不能猜测回执。', 'tool-call', (reply, item) => reply.includes('echo-accepted-42') && host.core.journal.events(item.route).some(e => e.traceId === item.id && e.type === 'operation.succeeded'));
  report.passed = host.calls.length > 0 && host.calls.every(call => call.provider === model.provider && call.model === model.model && call.reasoningEffort === model.reasoningEffort && call.status === 'completed');
  if (!report.passed) throw new Error('Model route or reasoning mismatch');
} catch (error) {
  report.error = error instanceof Error && error.message.startsWith('Acceptance') ? error.message : 'Acceptance stopped; inspect classified faults';
  process.exitCode = 1;
} finally {
  if (host) { report.calls = host.calls; report.faults = host.faults; await host.close(); }
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ stage: 'A', passed: report.passed, report: resolve(root, 'report.json'), faults: report.faults }));
}
