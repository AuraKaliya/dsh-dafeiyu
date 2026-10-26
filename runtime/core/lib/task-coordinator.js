import { z } from 'zod';
import { TaskDeliverySubmitSchema, TaskDeliveryStatusSchema } from '#dafeiyu/contracts';
import { ExpressionPolicySchema, ExpressionPrepareSchema, ExpressionOpenSchema, ExpressionGenerateSchema, ExpressionResultSchema, ExpressionWithdrawSchema } from '#dafeiyu/contracts';
import { TaskMemoryPolicySchema, TaskMemoryGrantSchema, TaskMemoryRevokeSchema, TaskMemoryQuerySchema, TaskMemoryOpenSchema, TaskMemorySelectSchema } from '#dafeiyu/contracts';
import { ConversationSchema, MemoryObservationSchema, TaskCreateSchema, TaskUpdateSchema, TaskSceneSchema, TaskActivateSchema, TaskLinkSchema, TaskBeginSchema, TaskCompleteSchema } from '#dafeiyu/contracts';
export function bindTaskMemoryProvider(p) { return { policy: p.policy.bind(p), grant: p.grant.bind(p), check: p.check.bind(p), revoke: p.revoke.bind(p), recall: p.recall.bind(p), open: p.open.bind(p), select: p.select.bind(p) }; }
export function bindExpressionProvider(p) { return { policy: p.policy.bind(p), prepare: p.prepare.bind(p), open: p.open.bind(p), generate: p.generate.bind(p), result: p.result.bind(p), withdraw: p.withdraw.bind(p), deliveryMaterial: p.deliveryMaterial.bind(p), verifyDelivery: p.verifyDelivery.bind(p) }; }
export function bindTaskProvider(p) {
    return {
        current: p.current.bind(p),
        create: p.create.bind(p), read: p.read.bind(p), update: p.update.bind(p), join: p.join.bind(p), activate: p.activate.bind(p), link: p.link.bind(p), begin: p.begin.bind(p),
        observe: p.observe.bind(p), complete: p.complete.bind(p), view: p.view.bind(p),
    };
}
/** Non-model coordinator capabilities. Scene handlers receive references/tickets, never
 * the coordinator's private read function or a caller-selectable global scope. */
export class TaskCoordinator {
    agentId;
    provider;
    assertOpen;
    memoryProvider;
    expressionProvider;
    deliveryHost;
    references = new WeakMap();
    jobs = new WeakMap();
    constructor(agentId, provider, assertOpen, memoryProvider, expressionProvider, deliveryHost) {
        this.agentId = agentId;
        this.provider = provider;
        this.assertOpen = assertOpen;
        this.memoryProvider = memoryProvider;
        this.expressionProvider = expressionProvider;
        this.deliveryHost = deliveryHost;
    }
    expression() { this.assertOpen(); const p = this.expressionProvider(); if (!p)
        throw new Error('Task expression provider unavailable'); return p; }
    expressionPolicy(raw) { return this.expression().policy(this.agentId, ExpressionPolicySchema.parse(raw)); }
    memory() { this.assertOpen(); const p = this.memoryProvider(); if (!p)
        throw new Error('Task memory provider unavailable'); return p; }
    policy(raw) { return this.memory().policy(this.agentId, TaskMemoryPolicySchema.parse(raw)); }
    access(reference, grantId, p) {
        const guard = () => { this.reference(reference); if (this.memory() !== p)
            throw new Error('Task memory capability expired'); p.check(this.agentId, reference.id, grantId); };
        guard();
        return Object.freeze({ id: grantId, recall: async (raw, signal = AbortSignal.timeout(30000)) => { guard(); const result = await p.recall(this.agentId, reference.id, grantId, TaskMemoryQuerySchema.parse(raw), signal, guard); guard(); return result; },
            open: (raw) => { guard(); return p.open(this.agentId, reference.id, grantId, TaskMemoryOpenSchema.parse(raw)); },
            select: (raw) => { guard(); return p.select(this.agentId, reference.id, grantId, TaskMemorySelectSchema.parse(raw)); } });
    }
    current() { this.assertOpen(); const provider = this.provider(); if (!provider)
        throw new Error('Task workspace provider unavailable'); return provider; }
    reference(value) { const provider = this.current(), ref = this.references.get(value); if (!ref || ref.provider !== provider)
        throw new Error('No current core-issued task reference'); return ref; }
    create(raw) { const provider = this.current(), id = provider.create(this.agentId, TaskCreateSchema.parse(raw)); return this.wrap(id, provider); }
    resume(id) { const provider = this.current(); z.uuid().parse(id); provider.read(this.agentId, id); return this.wrap(id, provider); }
    wrap(id, provider) {
        const reference = Object.freeze({ id });
        this.references.set(reference, { id, provider });
        const memory = Object.freeze({ grant: (raw) => { this.reference(reference); const p = this.memory(); return this.access(reference, p.grant(this.agentId, id, TaskMemoryGrantSchema.parse(raw)), p); },
            resume: (grantId) => { this.reference(reference); return this.access(reference, z.uuid().parse(grantId), this.memory()); },
            revoke: (raw) => { this.reference(reference); return this.memory().revoke(this.agentId, id, TaskMemoryRevokeSchema.parse(raw)); } });
        const expression = Object.freeze({
            prepare: (raw) => { this.reference(reference); return this.expression().prepare(this.agentId, id, ExpressionPrepareSchema.parse(raw)); },
            open: (raw) => { this.reference(reference); return this.expression().open(this.agentId, id, ExpressionOpenSchema.parse(raw)); },
            result: (raw) => { this.reference(reference); return this.expression().result(this.agentId, id, ExpressionResultSchema.parse(raw)); },
            withdraw: (raw) => { this.reference(reference); return this.expression().withdraw(this.agentId, id, ExpressionWithdrawSchema.parse(raw)); },
            generate: async (raw, signal = AbortSignal.timeout(60000)) => {
                this.reference(reference);
                const p = this.expression();
                const guard = () => { this.reference(reference); if (this.expression() !== p)
                    throw new Error('Task expression provider changed'); };
                const result = await p.generate(this.agentId, id, ExpressionGenerateSchema.parse(raw), signal, guard);
                guard();
                return result;
            },
        });
        const delivery = Object.freeze({ submit: (raw, signal = AbortSignal.timeout(60000)) => { this.reference(reference); return this.deliveryHost.submit(id, TaskDeliverySubmitSchema.parse(raw), signal, () => this.reference(reference)); },
            status: (raw) => { this.reference(reference); return this.deliveryHost.status(id, TaskDeliveryStatusSchema.parse(raw).deliveryId); } });
        return Object.freeze({ reference, memory, expression, delivery, read: () => { this.reference(reference); return provider.read(this.agentId, id); },
            update: (raw) => { this.reference(reference); return provider.update(this.agentId, id, TaskUpdateSchema.parse(raw)); } });
    }
    forExtension(authorize, assertActive) {
        const issuer = {};
        const ticket = (value) => { assertActive(); const provider = this.current(), job = this.jobs.get(value); if (!job || job.issuer !== issuer || job.provider !== provider)
            throw new Error('No current producer work ticket'); return job; };
        return {
            join: (task, raw, context) => { const input = TaskSceneSchema.parse(raw), authority = authorize(input.conversation, context), ref = this.reference(task); return ref.provider.join(authority, ref.id, input); },
            activate: (task, raw, context) => { const input = TaskActivateSchema.parse(raw), authority = authorize(input.conversation, context), provider = this.current(), ref = task ? this.reference(task) : null; return provider.activate(authority, ref?.id ?? null, input); },
            link: (task, raw, context) => { const input = TaskLinkSchema.parse(raw), authority = authorize(input.conversation, context), ref = this.reference(task); return ref.provider.link(authority, ref.id, input); },
            begin: (task, raw, context) => { const input = TaskBeginSchema.parse(raw), authority = authorize(input.conversation, context), ref = this.reference(task), id = ref.provider.begin(authority, ref.id, input), work = Object.freeze({ id }); this.jobs.set(work, { id, provider: ref.provider, issuer, authority }); return work; },
            observe: (work, raw) => { const job = ticket(work); return job.provider.observe(job.authority, job.id, MemoryObservationSchema.parse(raw)); },
            complete: (work, raw) => { const job = ticket(work); return job.provider.complete(job.authority, job.id, TaskCompleteSchema.parse(raw)); },
            view: (task, conversation, context) => { const authority = authorize(ConversationSchema.parse(conversation), context), ref = this.reference(task); return ref.provider.view(authority, ref.id); },
        };
    }
}
