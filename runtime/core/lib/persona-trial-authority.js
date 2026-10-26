import { runtimeHash } from './runtime-store.js';
function freeze(value) { if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
} }
/** A guard function is not a grant: identity and the exact callback payload are checked separately. */
export class PersonaTrialAuthorities {
    grants = new WeakMap();
    invoke(input, access, verify, receive) {
        const fixed = structuredClone(input);
        freeze(fixed);
        const inputHash = runtimeHash(fixed);
        const authority = Object.freeze({ guard: () => this.assert(authority, fixed) });
        const trusted = Object.freeze({ ...access, guard: authority.guard, commitGuard: authority.guard });
        this.grants.set(authority, { inputHash, verify: () => { access.guard(); verify(); }, access: trusted });
        try {
            authority.guard();
            return receive(fixed, authority);
        }
        finally {
            this.grants.delete(authority);
        }
    }
    assert(authority, input) {
        const grant = authority && typeof authority === 'object' ? this.grants.get(authority) : undefined;
        let hash = null;
        try {
            hash = runtimeHash(input);
        }
        catch { /* Non-JSON input cannot carry a callback grant. */ }
        if (!grant || hash !== grant.inputHash)
            throw new Error('PERSONA_TRIAL_AUTHORITY_INVALID');
        grant.verify();
    }
    access(authority, input) {
        this.assert(authority, input);
        const grant = authority && typeof authority === 'object' ? this.grants.get(authority) : undefined;
        if (!grant)
            throw new Error('PERSONA_TRIAL_AUTHORITY_INVALID');
        return grant.access;
    }
}
