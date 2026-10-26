import { randomUUID } from 'node:crypto';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { digestSource } from './source-records.js';
import { composeFragmentContent, fragmentManifestSchema, fragmentDependencies, resolveFragmentView, renderFragmentView, summaryReference } from './summary-fragments.js';
function contiguous(session, parents) {
    const seqs = parents.map(p => p.checkpoint.seq), start = session.surface.nodes.indexOf(seqs[0]);
    return start >= 0 && JSON.stringify(session.surface.nodes.slice(start, start + seqs.length)) === JSON.stringify(seqs);
}
/** Prepare without side effects. Selection, source validity and proof validity are distinct. */
export function prepareSummaryComposition(session, scope, refs, options, validate) {
    try {
        if (!refs.length || refs.length > 8 || new Set(refs).size !== refs.length)
            return null;
        const parents = [];
        for (const ref of refs) {
            const view = resolveFragmentView(session, ref, scope);
            if (!view || ref !== summaryReference(view.manifestSeq, view.manifest) || view.manifest.owner !== options.owner || !view.view.active.length || !validate(fragmentDependencies(view))
                || view.manifest.groups.some(g => view.manifest.fragments.some(f => f.group === g.id && view.view.active.includes(f.id))
                    && options.protectedTaskId !== null && g.taskId === options.protectedTaskId))
                return null;
            parents.push(view);
        }
        if (!contiguous(session, parents))
            return null;
        const content = composeFragmentContent(parents);
        if (content.fragments.length > options.maxFragments || content.groups.length > options.maxGroups)
            return null;
        const { rewrite: _rewrite, ...first } = parents[0].manifest;
        const tasks = new Set(content.groups.map(g => g.taskId));
        const manifest = fragmentManifestSchema.parse({ ...first, ...content, compactionId: randomUUID(), producerVersion: options.version,
            taskId: tasks.size === 1 ? content.groups[0].taskId : null, epoch: digestSource(JSON.stringify(content.groups)), versions: {},
            model: { provider: 'none', model: 'deterministic-lossless-pack-v1' },
            policy: 'dafeiyu-lossless-pack-v1', policyHash: digestSource(JSON.stringify(options)), createdAt: Date.now() });
        const text = renderFragmentView(session.seq, manifest, manifest.fragments.map(f => f.id));
        if (Buffer.byteLength(text) > options.maxBytes)
            return null;
        return { scope: { ...scope }, options: { ...options }, manifest, parents, surfaceGeneration: session.surface.replaceGeneration };
    }
    catch {
        return null;
    }
}
/** One DSH surface replacement is the commit point. A manifest/view/prune without that
 * message is an orphan, so restart retains the parents. No multi-node dual write exists.
 * Caller must flush successfully before dispatching any model request. */
export function commitSummaryComposition(ctx, session, plan, validate) {
    const refs = plan.manifest.composition.parents.map(p => p.ref);
    const fresh = prepareSummaryComposition(session, plan.scope, refs, plan.options, validate);
    if (!fresh || session.surface.replaceGeneration !== plan.surfaceGeneration
        || JSON.stringify(composeFragmentContent(fresh.parents)) !== JSON.stringify(composeFragmentContent(plan.parents)))
        throw new Error('Summary composition conflict');
    // Reject tampered plans as well as stale versions. Identity/creation time are not lineage.
    const expected = fragmentManifestSchema.parse({ ...fresh.manifest, compactionId: plan.manifest.compactionId, createdAt: plan.manifest.createdAt });
    if (JSON.stringify(expected) !== JSON.stringify(plan.manifest))
        throw new Error('Summary composition proof changed');
    const meter = ctx.get('tokenMeter');
    if (!meter)
        throw new Error('DSH token meter unavailable');
    const seqs = fresh.parents.map(p => p.checkpoint.seq), selected = new Set(seqs), measurement = meter.measure(session);
    const manifestSeq = appendPluginRecord(session, 'plugin:dafeiyu/summary-manifest', plan.manifest);
    const active = plan.manifest.fragments.map(f => f.id), text = renderFragmentView(manifestSeq, plan.manifest, active);
    const viewSeq = appendPluginRecord(session, 'plugin:dafeiyu/summary-view', { schemaVersion: 1, manifestSeq, revision: 1,
        previousViewSeq: null, previousCheckpointSeq: null, active, contentHash: digestSource(text) });
    session.append('compaction/prune', { shadowedRange: { start: seqs[0], end: seqs.at(-1) }, shadowedSeqs: seqs,
        shadowedTokenCount: measurement.nodes.filter(n => selected.has(n.seq)).reduce((sum, n) => sum + n.heuristicTokens, 0) });
    session.append('user/message', createUserMessage({ source: { kind: 'dafeiyu-summary-view', compactionId: plan.manifest.compactionId }, content: [{ type: 'text', text }] }), { surfaceOp: { op: 'replace', startSeq: seqs[0], endSeq: seqs.at(-1) }, sourceEventSeqs: [...seqs, manifestSeq, viewSeq] });
    const view = resolveFragmentView(session, summaryReference(manifestSeq, plan.manifest), plan.scope);
    if (!view)
        throw new Error('Summary composition commit verification failed');
    return view;
}
/** Foreign/native nodes and ordinary conversation are barriers, including empty views. */
export function summaryCompositionRuns(session, scope) {
    const events = session.snapshotEvents(), runs = [];
    let run = [];
    for (const seq of session.surface.nodes) {
        const e = events[seq];
        let ref;
        if (e?.type === 'user/message' && (e.data.source.kind === 'compact-checkpoint' || e.data.source.kind === 'dafeiyu-summary-view')) {
            try {
                const body = JSON.parse(e.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
                if (typeof body === 'object' && body !== null && 'ref' in body && typeof body.ref === 'string') {
                    const view = resolveFragmentView(session, body.ref, scope);
                    if (view?.checkpoint.seq === seq && view.view.active.length)
                        ref = body.ref;
                }
            }
            catch { /* An unproven checkpoint is a barrier, never a merge input. */ }
        }
        if (ref) {
            if (run.length === 8) {
                runs.push(run);
                run = [];
            }
            run.push(ref);
        }
        else if (run.length) {
            runs.push(run);
            run = [];
        }
    }
    if (run.length)
        runs.push(run);
    return runs;
}
