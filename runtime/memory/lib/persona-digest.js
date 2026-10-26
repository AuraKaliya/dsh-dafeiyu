import { createHash } from 'node:crypto';
import { z } from 'zod';
function canonical(value) { if (value === null || typeof value !== 'object')
    return JSON.stringify(value); if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`; return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`; }
export const personaDigest = (value) => createHash('sha256').update(canonical(z.json().parse(value))).digest('hex');
export const personaScope = (scope) => scope.kind === 'task' ? scope.scopeKey : scope.route;
export const sourceKey = (ref) => `${ref.kind}:${personaDigest(ref)}`;
export function uniqueSources(refs) { const byKey = new Map(); for (const ref of refs) {
    const key = sourceKey(ref), old = byKey.get(key);
    if (old && personaDigest(old) !== personaDigest(ref))
        throw new Error('SOURCE_VERSION_CONFLICT');
    byKey.set(key, ref);
} return [...byKey.values()]; }
