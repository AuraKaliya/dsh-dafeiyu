import { z } from 'zod';
export const LifecycleModeSchema = z.enum(['legacy', 'managed']);
/** Runtime readiness is independent of constructing a service or opening its storage. */
export class ServiceGate {
    phase = 'registered';
    get state() { return this.phase; }
    get active() { return this.phase === 'active'; }
    recovered() {
        if (this.phase === 'recovered' || this.phase === 'active')
            return;
        if (this.phase !== 'registered')
            throw new Error('SERVICE_LIFECYCLE_CONFLICT');
        this.phase = 'recovered';
    }
    activate() {
        if (this.phase === 'active')
            return;
        if (this.phase !== 'recovered')
            throw new Error('SERVICE_NOT_RECOVERED');
        this.phase = 'active';
    }
    quiesce() { if (this.phase !== 'closed')
        this.phase = 'quiescing'; }
    close() { this.phase = 'closed'; }
    assertActive() { if (!this.active)
        throw new Error('HOST_NOT_READY'); }
}
/** Deterministic activation order; bind-time seams must not be declared as activation cycles. */
export function dependencyOrder(components, available = []) {
    const names = new Set(), provider = new Map(), builtins = new Set(available);
    for (const component of components) {
        if (names.has(component.id))
            throw new Error('DUPLICATE_COMPONENT');
        names.add(component.id);
        for (const feature of component.provides) {
            if (provider.has(feature) || builtins.has(feature))
                throw new Error('DUPLICATE_FEATURE');
            provider.set(feature, component.id);
        }
    }
    const pending = new Map(components.map(component => [component.id, new Set(component.requires.map(feature => {
            const owner = provider.get(feature);
            if (!owner && !builtins.has(feature))
                throw new Error('DEPENDENCY_UNAVAILABLE');
            return owner;
        }).filter((owner) => owner !== undefined && owner !== component.id))]));
    const result = [];
    while (pending.size) {
        const ready = [...pending].filter(([, requirements]) => requirements.size === 0).map(([id]) => id).sort();
        if (!ready.length)
            throw new Error('DEPENDENCY_CYCLE');
        for (const id of ready) {
            result.push(id);
            pending.delete(id);
            for (const requirements of pending.values())
                requirements.delete(id);
        }
    }
    return result;
}
