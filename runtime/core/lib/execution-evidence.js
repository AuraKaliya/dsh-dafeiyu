import { z } from 'zod';
import { ContextItemSchema, ExecutionToolReceiptSchema, PersonaSourceRefSchema, SourceDependencySchema, ActivityAnchorSchema } from '#dafeiyu/contracts';
import { runtimeHash } from './runtime-store.js';
import { digestSource, unionDependencies } from './source-records.js';
const dependencies = z.array(SourceDependencySchema).max(4096);
const inputProof = z.strictObject({ schemaVersion: z.literal(1), epoch: z.number().int().positive(), inputHash: z.string(), sources: z.array(PersonaSourceRefSchema), continuity: z.strictObject({ id: z.uuid(), hash: z.string() }).nullable(), authorities: z.array(ActivityAnchorSchema).max(64).optional() });
const contextRecord = z.strictObject({ owner: z.string(), region: z.string(), item: ContextItemSchema });
/** Source proofs refer to real native task inputs and persisted operation outcomes. */
export class ExecutionEvidence {
    run;
    store;
    memory;
    personas;
    registry;
    repository;
    rules;
    base;
    authorityValid;
    authorityRequired;
    admitted = [];
    contexts = [];
    checking = new Set();
    validationMemo = new Map();
    validationDepth = 0;
    invalidated = false;
    bound;
    constructor(run, store, memory, personas, registry, repository, rules, base, authorityValid = () => false, authorityRequired = () => false) {
        this.run = run;
        this.store = store;
        this.memory = memory;
        this.personas = personas;
        this.registry = registry;
        this.repository = repository;
        this.rules = rules;
        this.base = base;
        this.authorityValid = authorityValid;
        this.authorityRequired = authorityRequired;
    }
    access(base = this.base) {
        return { ...base, sourceRules: this.rules, historyDependencies: this.admitted, historyTracked: true,
            validateHistory: deps => this.validate(deps), operationFinished: id => { try {
                const op = this.store.operation(id), run = this.store.get(op.runId);
                return run.definition.taskId === this.run.definition.taskId && op.state === 'finished' && ['succeeded', 'partial'].includes(op.outcome?.status ?? '');
            }
            catch {
                return false;
            } },
            verifyMemorySource: ref => {
                try {
                    if (ref.kind !== 'memory' || !ref.selectionId || !ref.authorization || !this.rules.includes(ref.authorization.policyId))
                        return null;
                    const input = this.repository.readSelectedInputs(ref.agentId, this.run.definition.taskId, [`task-link:${ref.selectionId}`], this.rules)[0];
                    return input?.sourceRef && runtimeHash(input.sourceRef) === runtimeHash(ref) ? { text: input.text, rootSources: input.rootSources ?? [] } : null;
                }
                catch {
                    return null;
                }
            } };
    }
    recordInput(input, sources, continuity, authorities = []) { this.store.bindInput(this.run.id, 'native-program', { schemaVersion: 1, epoch: this.run.definition.intentVersion, inputHash: runtimeHash(input), sources, continuity, authorities }); }
    setContexts(contexts) {
        this.contexts = contexts;
        for (const context of contexts)
            this.store.bindInput(this.run.id, `context:${runtimeHash(this.dependency(context))}`, context);
    }
    dependency({ owner, region, item }) { return { kind: 'context', agentId: this.base.view.scope.agentId, route: this.route(), owner, region, id: item.id, version: item.version, hash: digestSource(JSON.stringify([item.text, item.sources])) }; }
    route() { if (this.run.definition.scope.kind !== 'task')
        throw new Error('TASK_REQUIRED'); return this.run.definition.scope.scopeKey; }
    unavailable(reason) { return [{ kind: 'unavailable', agentId: this.base.view.scope.agentId, route: this.route(), reason }]; }
    expose(value) { this.admitted = unionDependencies(this.admitted, value); }
    invalidate() { this.invalidated = true; }
    exposed() { return structuredClone(this.admitted); }
    contextView() { return { sourceItems: () => this.contexts, nativeDependencies: () => [], validateHistorical: dep => this.validate([dep]) }; }
    sourceRefs(deps = this.admitted) { return [...new Map(deps.filter((dep) => dep.kind === 'execution-source').map(dep => [runtimeHash(dep.ref), dep.ref])).values()]; }
    validate(deps) {
        if (this.invalidated)
            return false;
        const outer = this.validationDepth++ === 0;
        try {
            return deps.every(dep => {
                const key = runtimeHash(dep), cached = this.validationMemo.get(key);
                if (cached !== undefined)
                    return cached;
                if (this.checking.has(key) || this.checking.size >= 128)
                    return false;
                this.checking.add(key);
                try {
                    const valid = this.valid(dep);
                    this.validationMemo.set(key, valid);
                    return valid;
                }
                catch {
                    return false;
                }
                finally {
                    this.checking.delete(key);
                }
            });
        }
        finally {
            this.validationDepth--;
            if (outer)
                this.validationMemo.clear();
        }
    }
    valid(dep) {
        if (dep.agentId !== this.base.view.scope.agentId || dep.route !== this.route())
            return false;
        this.base.guard();
        if (dep.kind === 'execution-source')
            return this.memory()?.validate(this.access(), dep.ref) ?? false;
        if (dep.kind === 'execution-input') {
            const run = this.store.get(dep.runId), body = inputProof.safeParse(this.store.readInput(dep.runId, 'native-program'));
            return run.definition.taskId === this.run.definition.taskId && body.success && body.data.epoch === run.definition.intentVersion && runtimeHash(body.data) === dep.hash
                && (!this.authorityRequired(run) || !!body.data.authorities?.length) && (body.data.authorities ?? []).every(anchor => this.authorityValid(anchor))
                && body.data.sources.every(ref => this.memory()?.validate(this.access(), ref)) && (!body.data.continuity || (() => { const checkpoint = this.memory()?.checkpoint(this.access(), body.data.continuity.id, true); return !!checkpoint && runtimeHash(checkpoint) === body.data.continuity.hash; })());
        }
        if (dep.kind === 'execution-operation') {
            const op = this.store.operation(dep.operationId), run = this.store.get(op.runId), body = this.store.readInput(op.runId, `operation-inputs:${op.id}`);
            return op.runId === dep.runId && run.definition.taskId === this.run.definition.taskId && op.state === 'finished' && !!op.outcome && runtimeHash(op.outcome) === dep.hash
                && body !== null && runtimeHash(body) === dep.inputHash && this.validate(dependencies.parse(body));
        }
        if (dep.kind === 'context') {
            const record = contextRecord.safeParse(this.store.findContext(`context:${runtimeHash(dep)}`));
            if (!record.success || Date.parse(record.data.item.expiresAt) <= Date.now() || runtimeHash(this.dependency(record.data)) !== runtimeHash(dep))
                return false;
            if (dep.owner === 'memory' && dep.region === 'growth')
                return dep.id === 'persona:availability' || this.personas.historical(this.access(), dep);
            if (dep.owner === 'memory' && dep.region === 'execution')
                return this.memory()?.validateContext(this.access(), record.data.item) ?? false;
            if (dep.owner === 'dsh-tools' && dep.region === 'capabilities')
                return true; // Immutable operational declarations; dispatch checks the current catalog separately.
            return this.registry.contributors().some(entry => entry.owner === dep.owner && entry.context.id === dep.region && entry.active() && entry.context.validate(this.base.view, record.data.item));
        }
        return dep.kind === 'ephemeral' && dep.traceId === this.run.id;
    }
    binding() {
        if (this.bound)
            return this.bound;
        const port = this.memory(), scopeFields = { agentId: this.base.view.scope.agentId, route: this.route() };
        const provider = { policy: port?.compactionPolicy ?? { enabled: false, inputTokens: 8192, thresholdRatio: 0.75, targetRatio: 0.58, minGrowthTokens: 1024, minSavingsTokens: 512, cooldownMs: 60000, retainTurns: 2, maxSourceBytes: 65536, maxSummaryChars: 2000 },
            basis: () => { const generation = port?.generation(this.access()) ?? 0; return { epoch: runtimeHash([generation, port?.resourceEpoch?.(this.access()) ?? null]), taskId: this.run.definition.taskId, protectedRunId: this.run.id, versions: { memory: generation } }; },
            sources: {
                inbound: (_scope, id) => {
                    const body = this.store.readInput(id, 'native-program');
                    if (!body)
                        return this.unavailable('missing-native-input');
                    const proof = inputProof.parse(body);
                    return [{ ...scopeFields, kind: 'execution-input', runId: id, hash: runtimeHash(proof) }, ...proof.sources.map(ref => ({ ...scopeFields, kind: 'execution-source', ref }))];
                },
                context: (_scope, region, item) => {
                    const own = this.contexts.find(context => context.owner === 'memory' && context.region === region && context.item.id === item.id);
                    if (!own)
                        return this.unavailable('missing-context');
                    const refs = region === 'growth' ? (() => {
                        const manifest = this.personas.current(this.run.id)?.manifest;
                        if (!manifest)
                            return [];
                        return [...manifest.entries.filter(entry => `persona:${entry.candidate.id}` === item.id).flatMap(entry => [entry.contentRef, ...entry.dependencies]),
                            ...(manifest.schemaVersion === 2 ? manifest.trialEntries.filter(entry => `persona-trial:${entry.candidate.id}` === item.id).flatMap(entry => [entry.contentRef, ...entry.dependencies]) : [])];
                    })()
                        : (() => { try {
                            const value = z.object({ source: PersonaSourceRefSchema }).safeParse(JSON.parse(item.text));
                            return value.success ? [value.data.source] : [];
                        }
                        catch {
                            return [];
                        } })();
                    return [this.dependency(own), ...refs.map(ref => ({ ...scopeFields, kind: 'execution-source', ref }))];
                },
                tool: (_scope, _name, _text, meta) => {
                    const parsed = z.object({ dafeiyuExecution: ExecutionToolReceiptSchema }).safeParse(meta);
                    if (!parsed.success)
                        return this.unavailable('unbound-tool-result');
                    const receipt = parsed.data.dafeiyuExecution;
                    const proof = this.store.readInput(receipt.runId, `operation-receipt:${receipt.operationId}`);
                    if (runtimeHash(proof) !== runtimeHash(receipt))
                        return this.unavailable('receipt-mismatch');
                    return unionDependencies([{ ...scopeFields, kind: 'execution-operation', runId: receipt.runId, operationId: receipt.operationId, hash: receipt.outcomeHash, inputHash: receipt.inputHash }], receipt.sources.map(ref => ({ ...scopeFields, kind: 'execution-source', ref })));
                },
                validate: (_scope, dep) => this.validate([dep]),
            },
            summarize: (scope, sources, signal, check) => { if (!port)
                throw new Error('DEPENDENCY_UNAVAILABLE'); return port.summarize(scope, sources, signal, check); },
            ...(port?.summarizeFragments ? { summarizeFragments: port.summarizeFragments.bind(port) } : {}),
            ...(port?.rewrite ? { rewrite: port.rewrite.bind(port) } : {}), };
        return this.bound = { owner: 'memory', version: 'execution-sources-v1', provider };
    }
}
