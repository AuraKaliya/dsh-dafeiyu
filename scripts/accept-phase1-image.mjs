import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, randomInt, createHash } from 'node:crypto';
import { z } from 'zod';

const root = resolve('.runtime/phase1-probes', `image-${randomUUID()}`); await mkdir(root, { recursive: true });
process.env.DSH_HOME = resolve(root, 'dsh-home');
const { localHost, model } = await import('./local-host.mjs');
const { createImageFixture, ProbeAttachments } = await import('../build-tests/phase1-image-fixture.js');
const { createProbeAgent, installProbeProjection, probeInput, runProbeTurn, containsPrivateModelState } = await import('../build-tests/phase1-probe-fixture.js');
const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
const fixture = createImageFixture(randomInt(1, 0x7fffffff)), stats = { reasoningBlocks: 0, replayEnvelopes: 0, toolBlocks: 0 };
const report = { schemaVersion: 1, stage: '1A', probe: 'P1-P03', kind: 'real-model-real-image-fictional-fixture', at: new Date().toISOString(), model,
  serverAccess: false, fixtureHash: createHash('sha256').update(fixture.data).digest('hex'), checks: [], passed: false };
let host, handle, attachments;
const prompt = '如果没有收到图片，只回复NO_IMAGE。如果有图片，请按从左到右、从上到下的顺序列出六个格子中的颜色和形状。只输出JSON数组，每项只有color和shape两个字段。color取red/green/blue/yellow，shape取circle/square/triangle。';
try {
  host = await localHost(root, { simulator: false, realModel: true, timeout: 180000 });
  const info = await host.ctx.llm.resolveModelInfo(model.provider, model.model);
  report.capabilities = { id: info.id, inputModalities: info.inputModalities ?? null };
  if (!info.inputModalities?.includes('image')) throw new Error('IMAGE_ROUTE_NOT_DECLARED');
  await host.ctx.plugin({ name: 'phase1-fixture-attachments', apply(ctx) { attachments = new ProbeAttachments(ctx, join(root, 'attachments'), fixture); } });
  const ref = await attachments.saveImage({ data: fixture.data, mediaType: 'image/png', name: 'probe.png' });
  for (const withImage of [false, true]) {
    const id = `phase1-probe-image-${randomUUID()}`; installProbeProjection(host.ctx, id, stats);
    handle = await createProbeAgent(host.ctx, model, id);
    const base = probeInput(randomUUID(), randomUUID(), prompt);
    const input = withImage ? createUserMessage({ source: base.source, content: [...base.content, { type: 'image', attachment: ref }] }) : base;
    const result = await runProbeTurn(host.ctx, handle, input, 180000);
    if (!withImage) report.checks.push({ name: 'no-image-negative-control', passed: result.text.trim() === 'NO_IMAGE' });
    else {
      const text = result.text.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '');
      const actual = z.array(z.strictObject({ color: z.enum(['red','green','blue','yellow']), shape: z.enum(['circle','square','triangle']) })).length(6).parse(JSON.parse(text));
      report.checks.push({ name: 'image-only-six-cell-evidence', passed: JSON.stringify(actual) === JSON.stringify(fixture.expected), expected: fixture.expected, actual });
      report.checks.push({ name: 'image-bytes-requested-by-provider', passed: attachments.requestReads > 0, requestReads: attachments.requestReads });
      report.checks.push({ name: 'no-private-model-state', passed: !containsPrivateModelState(handle.agent.session.snapshotEvents()) });
    }
    await handle.dispose(); handle = undefined;
  }
} catch (error) {
  report.error = ['IMAGE_ROUTE_NOT_DECLARED','PROBE_RESIZE_REQUIRED','PROBE_TURN_INCOMPLETE'].includes(error?.message) ? error.message : 'IMAGE_PROBE_FAILED';
} finally {
  if (handle) await handle.dispose();
  if (host) { report.calls = host.calls.map(({sessionId:_id,at:_at,...call}) => call); try { await host.close(); } catch { report.error = 'CREDENTIAL_INTEGRITY_OR_CLOSE_FAILED'; } }
  report.passed = !report.error && report.checks.length === 4 && report.checks.every(check => check.passed);
  report.projection = stats; report.finishedAt = new Date().toISOString();
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
  await mkdir(resolve('docs/results'),{recursive:true}); await writeFile(resolve('docs/results/phase1a-image.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({probe:report.probe,passed:report.passed,checks:report.checks,error:report.error??null}));
  if (!report.passed) process.exitCode=1;
}
