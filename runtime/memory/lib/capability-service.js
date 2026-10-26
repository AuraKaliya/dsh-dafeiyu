import { conversationKey } from '#dafeiyu/contracts';
export class CapabilityObservationService {
    unbind;
    unvalidate;
    constructor(ctx, memory, ready, sourcePolicy, flush) {
        this.unvalidate = memory.capabilities.bind((scope, body, access) => {
            if (!ready() || !ctx.dafeiyu.capabilityResourceCurrent(body.proof))
                return false;
            if (body.scope.kind === 'task') {
                if (!access || access.view.scope.kind !== 'task' || access.view.scope.scopeKey !== scope.route || !access.resourceAllowed?.(body.proof.scene))
                    return false;
                return !body.history.length || !!access.validateHistory?.(body.history);
            }
            if (conversationKey(scope.agentId, body.proof.scene) !== scope.route)
                return false;
            return body.history.every(dep => dep.kind === 'context' ? ctx.dafeiyu.capabilityHistoryCurrent(scope, [dep]) : sourcePolicy.validate({ ...scope, traceId: body.origin.kind === 'message' ? body.origin.inboundId : body.runId }, dep));
        });
        this.unbind = ctx.dafeiyu.bindCapabilityObservations({ ready,
            record: (access, input) => { try {
                return memory.capabilities.record(access, input);
            }
            finally {
                flush();
            } },
            select: (access, input, text) => { try {
                return memory.capabilities.select(access, input, text);
            }
            finally {
                flush();
            } },
            valid: (scope, source, exposedHash) => memory.capabilities.valid(scope, source, exposedHash),
            mediaFence: (access, target, roots) => memory.capabilities.mediaFence(access, target, roots),
        });
    }
    close() { this.unbind(); this.unvalidate(); }
}
