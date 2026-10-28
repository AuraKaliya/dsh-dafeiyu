import { ContextItemSchema, PersonaManifestSchema, PersonaTrialAdmissionInputSchema, PersonaTrialCompletionInputSchema, PersonaRecordRefSchema, PersonaSourceEvidenceSchema, PersonaSourceRefSchema, SourceDependencySchema } from '#dafeiyu/contracts';
import { digestSource } from './source-records.js';
import { runtimeHash } from './runtime-store.js';
import { foundationManifest } from './persona-manifest.js';
import { z } from 'zod';
import { PersonaTrialAuthorities } from './persona-trial-authority.js';
const adoptedIdentity = (entry) => ({ candidate: entry.candidate, contentRef: entry.contentRef, dependencies: entry.dependencies });
const trialIdentity = (entry) => ({ projection: entry.projection, maturity: entry.maturity, ...adoptedIdentity(entry), trialSelection: entry.trialSelection, projectionHash: runtimeHash(entry.item) });
const legacyAdoption = { basis: 'legacy-unclassified', maturity: 'legacy-unclassified' };
const receiptSchema = z.strictObject({ inputHash: z.string().regex(/^[a-f0-9]{64}$/), closedEventId: z.uuid(), outcomes: z.array(PersonaRecordRefSchema).min(1).max(32) });
export class PersonaRuntime {
    config;
    provider;
    active = new Map();
    trialAuthorities = new PersonaTrialAuthorities();
    enrich = access => access;
    constructor(config) {
        this.config = config;
    }
    bind(provider) {
        if (this.provider)
            throw new Error('DUPLICATE_PROVIDER');
        const bound = Object.freeze({ ready: provider.ready.bind(provider), prepare: provider.prepare.bind(provider), validate: provider.validate.bind(provider),
            ...(provider.trialAdmitted ? { trialAdmitted: provider.trialAdmitted.bind(provider) } : {}), ...(provider.completeTrial ? { completeTrial: provider.completeTrial.bind(provider) } : {}),
            ...(provider.validateHistoricalTrial ? { validateHistoricalTrial: provider.validateHistoricalTrial.bind(provider) } : {}) });
        this.provider = bound;
        return () => { if (this.provider === bound)
            this.provider = undefined; };
    }
    get configured() { return !!this.provider; }
    get ready() { return !this.provider || this.provider.ready(); }
    prepareTarget(access) {
        access.guard();
        const provider = this.provider;
        if (provider && !provider.ready())
            throw new Error('DEPENDENCY_UNAVAILABLE');
        const prepared = provider?.prepare(access), entries = [];
        const limit = Math.min(this.config.maxBytes, this.config.regions['memory:growth']?.maxBytes ?? 4000);
        for (const entry of prepared?.entries ?? []) {
            if (!provider?.validate(access, entry))
                continue;
            const candidate = structuredClone(entry);
            ContextItemSchema.parse(candidate.item);
            entries.push(candidate);
            if (Buffer.byteLength(JSON.stringify(entries.map(value => value.item))) > limit) {
                if (this.config.assembly.mode === 'unified')
                    throw new Error('PERSONA_CONTEXT_CAPACITY');
                entries.pop();
            }
        }
        const stamp = runtimeHash({ scope: access.view.scope, selection: prepared?.selectionVersion ?? 0, entries: entries.map(entry => ({ candidate: entry.candidate, contentRef: entry.contentRef, dependencies: entry.dependencies })) });
        return { items: entries.map(entry => entry.item), stamp, guard: () => {
                access.guard();
                if (this.provider !== provider || provider && !provider.ready())
                    throw new Error('DEPENDENCY_UNAVAILABLE');
                const current = provider?.prepare(access);
                const identity = (entry) => runtimeHash({ candidate: entry.candidate, contentRef: entry.contentRef, dependencies: entry.dependencies });
                if ((current?.selectionVersion ?? 0) !== (prepared?.selectionVersion ?? 0) || entries.some(entry => !provider?.validate(access, entry) || !current?.entries.some(value => identity(value) === identity(entry))))
                    throw new Error('SOURCE_STALE');
            } };
    }
    prepare(run, foundation, model, inputs, signal, guard) {
        guard();
        if (this.active.has(run.id))
            throw new Error('RUN_ALREADY_PREPARED');
        const access = this.access(run, inputs, signal, guard), provider = this.provider;
        if (provider && !provider.ready())
            throw new Error('DEPENDENCY_UNAVAILABLE');
        const prepared = provider?.prepare(access), admitted = [], trials = [];
        const limit = Math.min(this.config.maxBytes, this.config.regions['memory:growth']?.maxBytes ?? 4000);
        const size = (items) => Buffer.byteLength(JSON.stringify({ owner: 'memory', region: 'growth', kind: 'working-state', items }), 'utf8');
        for (const entry of prepared?.entries ?? []) {
            const item = ContextItemSchema.parse(entry.item), candidate = structuredClone({ ...entry, item });
            if (!provider?.validate(access, candidate))
                continue;
            admitted.push(candidate);
            if (size(admitted.map(value => value.item)) > limit) {
                if (this.config.assembly.mode === 'unified')
                    throw new Error('PERSONA_CONTEXT_CAPACITY');
                admitted.pop();
            }
        }
        for (const entry of prepared?.trialEntries ?? []) {
            if (!provider?.trialAdmitted || !provider.completeTrial)
                continue;
            const candidate = structuredClone({ ...entry, item: ContextItemSchema.parse(entry.item) });
            if (candidate.projection !== 'trial' || candidate.maturity !== 'tentative')
                throw new Error('PERSONA_TRIAL_PROJECTION_INVALID');
            if (Date.parse(candidate.item.expiresAt) <= Date.now())
                continue;
            if (candidate.trialSelection.agentId !== run.definition.scope.agentId || candidate.trialSelection.scopeKey !== (run.definition.scope.kind === 'task' ? run.definition.scope.scopeKey : run.definition.scope.route))
                continue;
            if (!provider.validate(access, candidate))
                continue;
            trials.push(candidate);
            if (size([...admitted, ...trials].map(value => value.item)) > limit) {
                if (this.config.assembly.mode === 'unified')
                    throw new Error('PERSONA_CONTEXT_CAPACITY');
                trials.pop();
            }
        }
        let omitted = (prepared?.omitted ?? 0) + (prepared?.entries.length ?? 0) - admitted.length, omittedTrials = (prepared?.omittedTrials ?? 0) + (prepared?.trialEntries?.length ?? 0) - trials.length;
        const hasTrials = !!(prepared?.trialSelectionVersion || prepared?.trialEntries?.length || omittedTrials);
        let notice = omitted || omittedTrials ? ContextItemSchema.parse({ id: 'persona:availability', version: String(prepared?.selectionVersion ?? 0), text: hasTrials ? '本轮有选中成长或试行资料未能核验或未装入预算，未提供对应正文；未装入的试行不构成实际使用。不要补造内容，也不要据此断言过去从未形成过相关认识。' : '本轮有选中成长资料未能核验或未装入预算，未提供对应正文；不要补造内容，也不要据此断言过去从未形成过相关认识。',
            expiresAt: '9999-12-31T23:59:59.999Z', sources: [{ ref: 'dafeiyu:persona-availability', version: String(prepared?.selectionVersion ?? 0), hash: runtimeHash({ scope: run.definition.scope, omitted, ...(hasTrials ? { omittedTrials } : {}) }) }] }) : undefined;
        if (notice) {
            if (size([notice]) > limit)
                notice = undefined;
            else
                while ((admitted.length || trials.length) && size([...admitted, ...trials].map(value => value.item).concat(notice)) > limit) {
                    if (trials.length)
                        trials.pop();
                    else
                        admitted.pop();
                }
        }
        omitted = (prepared?.omitted ?? 0) + (prepared?.entries.length ?? 0) - admitted.length;
        omittedTrials = (prepared?.omittedTrials ?? 0) + (prepared?.trialEntries?.length ?? 0) - trials.length;
        const v2 = !!(prepared?.trialSelectionVersion || prepared?.trialEntries?.length || omittedTrials || admitted.some(entry => entry.adoption));
        const manifest = PersonaManifestSchema.parse({ ...foundationManifest(run, foundation, model), stageRevision: prepared?.stageRevision ?? 0, selectionVersion: prepared?.selectionVersion ?? 0,
            stageStatus: provider ? (omitted || omittedTrials ? 'degraded' : admitted.length || trials.length ? 'selected' : 'empty') : 'not-configured', omittedCandidates: omitted, entries: admitted.map(entry => ({ ...adoptedIdentity(entry), ...(v2 ? { adoption: entry.adoption ?? legacyAdoption } : {}) })), policyVersion: runtimeHash({ policy: v2 ? 'explicit-persona-v2' : 'explicit-persona-v1', automaticInference: false, scopeExpansion: false }),
            ...(v2 ? { schemaVersion: 2, assemblyVersion: '2', trialSelectionVersion: prepared?.trialSelectionVersion ?? 0, trialEntries: trials.map(trialIdentity), omittedTrials } : {}) });
        const result = { manifest, trialEntries: trials, items: [...admitted.map(entry => entry.item), ...trials.map(entry => entry.item), ...(notice ? [notice] : [])], projectionKey: runtimeHash({ foundation: foundation.version, selection: manifest.selectionVersion, entries: manifest.entries, ...(manifest.schemaVersion === 2 ? { trialSelection: manifest.trialSelectionVersion, trialEntries: manifest.trialEntries } : {}) }),
            guard: () => {
                guard();
                if (this.provider !== provider || provider && !provider.ready())
                    throw new Error('DEPENDENCY_UNAVAILABLE');
                if (provider && admitted.some(entry => !provider.validate(access, entry)))
                    throw new Error('SOURCE_STALE');
                if (trials.length) {
                    const current = provider?.prepare(access);
                    if (trials.some(entry => !provider?.validate(access, entry) || !current?.trialEntries?.some(value => runtimeHash(trialIdentity(value)) === runtimeHash(trialIdentity(entry)))))
                        throw new Error('SOURCE_STALE');
                }
            },
            dispose: () => { if (this.active.get(run.id) === result)
                this.active.delete(run.id); } };
        this.active.set(run.id, result);
        return result;
    }
    access(run, inputs, signal, guard) {
        return this.enrich(Object.freeze({ view: Object.freeze({ runId: run.id, taskId: run.definition.taskId, scope: run.definition.scope, origin: run.definition.origin, signal }),
            producer: 'core-persona', operationId: run.id, startedEventId: null, intentVersion: run.definition.intentVersion, motivation: { kind: 'unknown', basis: [] }, inputs, admittedSources: [], guard }), run);
    }
    historical(access, dependency) {
        const provider = this.provider;
        if (!provider?.ready())
            return false;
        if (dependency.id.startsWith('persona-trial:') && provider.validateHistoricalTrial)
            return provider.validateHistoricalTrial(access, dependency);
        const prepared = provider.prepare(access), entry = [...prepared.entries, ...(prepared.trialEntries ?? [])].find(entry => entry.item.id === dependency.id && entry.item.version === dependency.version && digestSource(JSON.stringify([entry.item.text, entry.item.sources])) === dependency.hash);
        return !!entry && provider.validate(access, entry);
    }
    current(runId) { return this.active.get(runId); }
    validateStored(run, manifest, inputs, signal, guard) {
        guard();
        if (!manifest.entries.length && (manifest.schemaVersion === 1 || !manifest.trialEntries.length))
            return;
        const provider = this.provider;
        if (!provider?.ready())
            throw new Error('DEPENDENCY_UNAVAILABLE');
        const access = this.access(run, inputs, signal, guard), prepared = provider.prepare(access);
        for (const entry of manifest.entries) {
            const current = prepared.entries.find(item => item.candidate.id === entry.candidate.id && item.candidate.version === entry.candidate.version);
            if (!current || runtimeHash({ ...adoptedIdentity(current), ...(manifest.schemaVersion === 2 ? { adoption: current.adoption ?? legacyAdoption } : {}) }) !== runtimeHash(entry) || !provider.validate(access, current))
                throw new Error('SOURCE_STALE');
        }
        if (manifest.schemaVersion === 2)
            for (const entry of manifest.trialEntries) {
                const current = prepared.trialEntries?.find(value => runtimeHash(trialIdentity(value)) === runtimeHash(entry));
                if (!current || !provider.validate(access, current))
                    throw new Error('SOURCE_STALE');
            }
    }
    assertTrialAuthority(authority, input) { this.trialAuthorities.assert(authority, input); }
    trialAccess(authority, input) { return this.trialAuthorities.access(authority, input); }
    admitTrial(store, runId, inputs, signal, guard) {
        const run = store.get(runId), binding = store.personaBinding(runId), prepared = this.current(runId);
        if (binding.kind !== 'bound' || binding.manifest.schemaVersion !== 2 || !binding.manifest.trialEntries.length)
            return;
        const provider = this.provider, event = store.latestRunEvent(runId, 'running');
        if (!provider?.ready() || !provider.trialAdmitted || !provider.completeTrial || !prepared || !event || run.state !== 'running')
            throw new Error('PERSONA_TRIAL_ADMISSION_UNAVAILABLE');
        const manifest = binding.manifest, manifestHash = runtimeHash(manifest), fixed = PersonaTrialAdmissionInputSchema.parse({ schemaVersion: 1, agentId: run.definition.scope.agentId, scope: run.definition.scope, runId, manifestHash, trialSelectionVersion: manifest.trialSelectionVersion, admittedAt: event.at,
            entries: manifest.trialEntries.map(entry => { const actual = prepared.trialEntries.find(value => runtimeHash(trialIdentity(value)) === runtimeHash(entry)); if (!actual)
                throw new Error('PERSONA_TRIAL_PROJECTION_INVALID'); return { candidate: entry.candidate, selection: entry.trialSelection, contentRef: entry.contentRef, dependencies: entry.dependencies, projectionHash: entry.projectionHash, sourceEvidence: actual.sourceEvidence }; }) });
        const verify = () => { guard(); const actual = store.personaBinding(runId); if (this.provider !== provider || !provider.ready() || store.get(runId).state !== 'running' || actual.kind !== 'bound' || runtimeHash(actual.manifest) !== manifestHash || store.latestRunEvent(runId, 'running')?.id !== event.id)
            throw new Error('PERSONA_TRIAL_AUTHORITY_INVALID'); };
        verify();
        prepared.guard();
        store.bindPersonaTrialRecord(runId, 'admission-input', fixed);
        const access = Object.freeze({ ...this.access(run, inputs, signal, verify), producer: 'core-persona-trial', startedEventId: event.id, admittedSources: [...new Map(fixed.entries.flatMap(entry => [entry.contentRef, ...entry.dependencies]).map(ref => [runtimeHash(ref), ref])).values()] });
        const admissions = z.array(PersonaRecordRefSchema).max(32).parse(this.trialAuthorities.invoke(fixed, access, verify, (input, authority) => provider.trialAdmitted(input, authority)));
        prepared.guard();
        verify();
        if (admissions.length !== fixed.entries.length || new Set(admissions.map(ref => ref.id)).size !== admissions.length)
            throw new Error('PERSONA_TRIAL_ADMISSION_INCOMPLETE');
        store.bindPersonaTrialRecord(runId, 'admission-receipt', { inputHash: runtimeHash(fixed), admissions });
    }
    completeTrial(store, runId, inputs, signal) {
        const result = (status, outcomes = [], code = null) => ({ runId, status, outcomes, code });
        const run = store.get(runId), binding = store.personaBinding(runId);
        if (binding.kind !== 'bound' || binding.manifest.schemaVersion !== 2 || !binding.manifest.trialEntries.length || !['completed', 'failed', 'cancelled', 'interrupted'].includes(run.state))
            return result('skipped');
        try {
            const event = store.latestRunEvent(runId, run.state), raw = store.readInput(runId, 'persona-trial:admission-input');
            if (!event)
                throw new Error('PERSONA_TRIAL_CLOSED_EVENT_MISSING');
            if (raw === null)
                return result('missing-admission', [], 'PERSONA_TRIAL_ADMISSION_MISSING');
            const admission = PersonaTrialAdmissionInputSchema.parse(raw), manifestHash = runtimeHash(binding.manifest);
            if (admission.runId !== runId || admission.agentId !== run.definition.scope.agentId || runtimeHash(admission.scope) !== runtimeHash(run.definition.scope) || admission.manifestHash !== manifestHash)
                throw new Error('PERSONA_TRIAL_BINDING_CONFLICT');
            if (admission.trialSelectionVersion !== binding.manifest.trialSelectionVersion || admission.admittedAt !== store.latestRunEvent(runId, 'running')?.at || runtimeHash(admission.entries.map(entry => ({ projection: 'trial', maturity: 'tentative', candidate: entry.candidate, contentRef: entry.contentRef, dependencies: entry.dependencies, trialSelection: entry.selection, projectionHash: entry.projectionHash }))) !== runtimeHash(binding.manifest.trialEntries) || run.state === 'completed' && run.result?.sessionId !== run.snapshot?.sessionId)
                throw new Error('PERSONA_TRIAL_BINDING_CONFLICT');
            const refs = new Map(), evidence = new Map();
            for (const entry of admission.entries) {
                for (const ref of [entry.contentRef, ...entry.dependencies])
                    refs.set(runtimeHash(ref), ref);
                for (const item of entry.sourceEvidence)
                    evidence.set(runtimeHash(item.source), item);
            }
            for (const input of inputs)
                if (input.sourceRef)
                    refs.set(runtimeHash(input.sourceRef), input.sourceRef);
            const resultSources = z.array(SourceDependencySchema).safeParse(store.readInput(runId, 'result-sources'));
            if (resultSources.success)
                for (const source of resultSources.data)
                    if (source.kind === 'execution-source')
                        refs.set(runtimeHash(source.ref), source.ref);
            const sources = z.array(PersonaSourceRefSchema).max(64).parse([...refs.values()]), sourceEvidence = sources.map(source => evidence.get(runtimeHash(source)) ?? PersonaSourceEvidenceSchema.parse({ source, nature: 'unknown', coverage: [], completeness: 'unknown', roots: [] })), gaps = [];
            const operations = store.operations(runId).map(operation => { if (!operation.outcome)
                gaps.push(`操作${operation.id}没有闭合回执，效果保持未知。`); return { id: operation.id, action: operation.action, status: operation.outcome?.status ?? 'unknown', effects: operation.outcome?.effects ?? 'unknown', completeness: operation.outcome?.completeness ?? 'unknown', outcomeHash: runtimeHash(operation.outcome) }; });
            if (run.state !== 'completed')
                gaps.push(`Run以${run.state}结束，没有完成结果。`);
            const fixed = PersonaTrialCompletionInputSchema.parse({ schemaVersion: 1, agentId: run.definition.scope.agentId, scope: run.definition.scope, runId, terminal: { state: run.state, result: run.state === 'completed' ? run.result : null }, closedAt: event.at, closedEventId: event.id, operations, sources, sourceEvidence, gaps });
            const previous = store.readInput(runId, 'persona-trial:completion-receipt');
            if (previous !== null) {
                const saved = receiptSchema.parse(previous);
                if (saved.inputHash !== runtimeHash(fixed) || saved.closedEventId !== event.id)
                    throw new Error('PERSONA_TRIAL_BINDING_CONFLICT');
                return result('completed', saved.outcomes);
            }
            const provider = this.provider;
            if (!provider?.ready() || !provider.completeTrial)
                throw new Error('DEPENDENCY_UNAVAILABLE');
            const verify = () => { const current = store.get(runId), actual = store.personaBinding(runId); if (this.provider !== provider || !provider.ready() || runtimeHash({ definition: current.definition, state: current.state, result: current.result }) !== runtimeHash({ definition: run.definition, state: run.state, result: run.result }) || actual.kind !== 'bound' || runtimeHash(actual.manifest) !== manifestHash || store.latestRunEvent(runId, current.state)?.id !== event.id || runtimeHash(store.operations(runId)) !== operationHash)
                throw new Error('PERSONA_TRIAL_AUTHORITY_INVALID'); }, operationHash = runtimeHash(store.operations(runId));
            const access = Object.freeze({ ...this.access(run, inputs, signal, verify), producer: 'core-persona-trial', startedEventId: event.id, admittedSources: sources });
            const outcomes = z.array(PersonaRecordRefSchema).max(32).parse(this.trialAuthorities.invoke(fixed, access, verify, (input, authority) => provider.completeTrial(input, authority)));
            if (!outcomes.length)
                return result('missing-admission', [], 'PERSONA_TRIAL_ADMISSION_MISSING');
            if (outcomes.length !== admission.entries.length || new Set(outcomes.map(ref => ref.id)).size !== outcomes.length)
                throw new Error('PERSONA_TRIAL_COMPLETION_INCOMPLETE');
            store.bindPersonaTrialRecord(runId, 'completion-receipt', { inputHash: runtimeHash(fixed), closedEventId: event.id, outcomes });
            return result('completed', outcomes);
        }
        catch (error) {
            const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message) ? error.message : 'PERSONA_TRIAL_COMPLETION_FAILED';
            store.appendExecutionEvent(runId, 'persona.trial-completion-deferred', { code });
            return result('deferred', [], code);
        }
    }
}
