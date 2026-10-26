import { randomUUID } from 'node:crypto';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { checkSemanticResult } from '#dafeiyu/contracts';
import { digestSource, unionDependencies } from './source-records.js';
import { activeFragments, fragmentDependencies, fragmentManifestSchema, rawRewriteInputs, renderFragmentView, resolveFragmentView, resolveFragmentProof, rewrittenContent, rewriteRequest, rewriteSchema, summaryGeneration, summaryReference } from './summary-fragments.js';
/** Planning filters original records without exposing retired summary prose to a model. */
export function prepareSummaryRewrite(session, scope, ref, groupId, mode, options, validate) {
    try {
        const parent = resolveFragmentView(session, ref, scope);
        if (!parent || ref !== summaryReference(parent.manifestSeq, parent.manifest) || parent.manifest.owner !== options.owner || summaryGeneration(parent.manifest) >= 64)
            return null;
        if (!resolveFragmentProof(session, ref, scope, session.seq, 1))
            return null;
        const group = parent.manifest.groups.find(g => g.id === groupId);
        if (!group || options.protectedTaskId !== null && group.taskId === options.protectedTaskId)
            return null;
        const active = activeFragments(parent), chosen = active.filter(f => f.group === groupId), other = active.filter(f => f.group !== groupId);
        const others = fragmentDependencies(parent, other.map(f => f.id));
        if (!validate(others))
            return null;
        const inputs = group.inputs.filter(input => { try {
            return validate(rawRewriteInputs(session, parent, [input]).dependencies);
        }
        catch {
            return false;
        } });
        if (!inputs.length)
            return null;
        if (mode === 'fusion' && (!chosen.length || inputs.length !== group.inputs.length || !validate(group.dependencies) || (group.semanticDepth ?? 0) >= options.maxConsecutive))
            return null;
        // A withdrawn group cannot be reinstated merely because its sources became readable.
        if (!chosen.length && (mode !== 'rebuild' || validate(group.dependencies) || inputs.length === group.inputs.length))
            return null;
        const request = rewriteRequest(session, parent, { mode, targetGroup: groupId, inputs, maxChars: options.maxChars });
        if (Buffer.byteLength(JSON.stringify(request)) > options.maxBytes)
            return null;
        const dependencies = unionDependencies(others, rawRewriteInputs(session, parent, inputs).dependencies);
        return { scope: { ...scope }, ref, parent, group: groupId, mode, options: { ...options }, inputs, request, dependencies, surfaceGeneration: session.surface.replaceGeneration };
    }
    catch {
        return null;
    }
}
export function assertRewriteCurrent(session, plan, validate) {
    const fresh = prepareSummaryRewrite(session, plan.scope, plan.ref, plan.group, plan.mode, plan.options, validate);
    if (!fresh || fresh.parent.viewSeq !== plan.parent.viewSeq || fresh.surfaceGeneration !== plan.surfaceGeneration
        || JSON.stringify(fresh.request) !== JSON.stringify(plan.request) || !validate(plan.dependencies))
        throw new Error('Semantic rewrite source conflict');
}
export function buildRewriteManifest(session, plan, value) {
    const result = checkSemanticResult(plan.request, value), parent = plan.parent;
    const rewrite = rewriteSchema.parse({ mode: plan.mode, generation: summaryGeneration(parent.manifest) + 1,
        parent: { ref: plan.ref, manifestSeq: parent.manifestSeq, viewSeq: parent.viewSeq, checkpointSeq: parent.checkpoint.seq, revision: parent.view.revision, hash: digestSource(parent.text) },
        targetGroup: plan.group, inputs: plan.inputs, dependencies: rawRewriteInputs(session, parent, plan.inputs).dependencies,
        consecutive: plan.mode === 'rebuild' ? 0 : (parent.manifest.groups.find(g => g.id === plan.group).semanticDepth ?? 0) + 1,
        maxChars: plan.options.maxChars, inputHash: digestSource(JSON.stringify(plan.request)), result });
    const { composition: _composition, rewrite: _previous, ...original } = parent.manifest;
    return fragmentManifestSchema.parse({ ...original, ...rewrittenContent(session, parent, rewrite), rewrite,
        compactionId: randomUUID(), producerVersion: plan.options.version, model: { provider: result.model.provider, model: result.model.model },
        epoch: digestSource(JSON.stringify(plan.dependencies)), versions: {}, policy: `dafeiyu-semantic-${plan.mode}-v1`, policyHash: digestSource(JSON.stringify(plan.options)), createdAt: Date.now() });
}
/** Separate generation from commit so the runtime can enforce its measured benefit gate. */
export async function generateSummaryRewrite(session, plan, provider, signal, validate) {
    if (!provider.rewrite)
        throw new Error('Semantic rewrite unavailable');
    const check = () => assertRewriteCurrent(session, plan, validate);
    check();
    const result = await provider.rewrite(plan.scope, plan.request, signal, check);
    check();
    return checkSemanticResult(plan.request, result);
}
export function commitSummaryRewrite(ctx, session, plan, result, validate) {
    assertRewriteCurrent(session, plan, validate);
    const manifest = buildRewriteManifest(session, plan, result), meter = ctx.get('tokenMeter');
    if (!meter)
        throw new Error('DSH token meter unavailable');
    const seq = plan.parent.checkpoint.seq, price = meter.measure(session).nodes.find(n => n.seq === seq)?.heuristicTokens ?? 0;
    const manifestSeq = appendPluginRecord(session, 'plugin:dafeiyu/summary-manifest', manifest), active = manifest.fragments.map(f => f.id), text = renderFragmentView(manifestSeq, manifest, active);
    const viewSeq = appendPluginRecord(session, 'plugin:dafeiyu/summary-view', { schemaVersion: 1, manifestSeq, revision: 1, previousViewSeq: null, previousCheckpointSeq: null, active, contentHash: digestSource(text) });
    session.append('compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq], shadowedTokenCount: price });
    session.append('user/message', createUserMessage({ source: { kind: 'dafeiyu-summary-view', compactionId: manifest.compactionId }, content: [{ type: 'text', text }] }), { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq, manifestSeq, viewSeq] });
    const view = resolveFragmentView(session, summaryReference(manifestSeq, manifest), plan.scope);
    if (!view)
        throw new Error('Semantic proof commit unavailable');
    return view;
}
