import { z } from 'zod';
import { PersonaCandidateRevisionSchema, PersonaSourceEvidenceSchema, PersonaRecordRefSchema, ExecutionScopeSchema } from '#dafeiyu/contracts';
import { personaDigest, personaScope, sourceKey, uniqueSources } from './persona-digest.js';
export const PERSONA_ADOPTION_POLICY = personaDigest({ policy: 'persona-trial-adoption-v1', automaticInference: false, scopeExpansion: false, scoreAuthority: false });
export function readPersonaCandidate(db, access, id, version) {
    access.guard();
    z.uuid().parse(id);
    const row = db.prepare(`SELECT r.body,r.body_hash FROM persona_candidates c JOIN persona_candidate_revisions r ON r.id=c.id AND r.version=${version === undefined ? 'c.version' : '?'} WHERE c.id=? AND c.agent_id=?`)
        .get(...(version === undefined ? [id, access.view.scope.agentId] : [z.number().int().positive().parse(version), id, access.view.scope.agentId]));
    if (!row)
        throw new Error('SCOPE_DENIED');
    const candidate = PersonaCandidateRevisionSchema.parse(JSON.parse(String(row.body)));
    if (candidate.agentId !== access.view.scope.agentId || personaDigest(candidate.scope) !== personaDigest(access.view.scope))
        throw new Error('SCOPE_DENIED');
    if (personaDigest(candidate) !== row.body_hash)
        throw new Error('PERSONA_STATE_CORRUPT');
    return candidate;
}
export function readPersonaProof(db, access, table, raw, schema) {
    access.guard();
    const ref = PersonaRecordRefSchema.parse(raw);
    const row = db.prepare(`SELECT body,body_hash FROM ${table} WHERE id=? AND agent_id=? AND scope_key=?`).get(ref.id, access.view.scope.agentId, personaScope(access.view.scope));
    if (!row)
        throw new Error('SCOPE_DENIED');
    const body = schema.parse(JSON.parse(String(row.body)));
    const identity = z.object({ id: z.uuid(), agentId: z.string(), scope: ExecutionScopeSchema }).parse(body);
    if (identity.id !== ref.id || identity.agentId !== access.view.scope.agentId || personaDigest(identity.scope) !== personaDigest(access.view.scope))
        throw new Error('SCOPE_DENIED');
    if (row.body_hash !== ref.hash || personaDigest(body) !== ref.hash)
        throw new Error('SOURCE_STALE');
    return body;
}
/** Legacy producers remain unknown; a primary label alone does not assert a real-world observation. */
export function describePersonaMaterial(ref, material) {
    if (material.evidence) {
        const evidence = PersonaSourceEvidenceSchema.parse(material.evidence);
        if (sourceKey(evidence.source) !== sourceKey(ref))
            throw new Error('SOURCE_STATE_CONFLICT');
        return evidence;
    }
    return PersonaSourceEvidenceSchema.parse({ source: ref, nature: 'unknown', coverage: [], completeness: 'unknown', roots: [...new Set(material.rootSources)].map(key => ({ key, nature: 'unknown' })) });
}
export function describePersonaSources(access, refs, resolve) {
    return uniqueSources(refs).map(ref => { const material = resolve(access, ref); if (!material)
        throw new Error('SOURCE_STALE'); return describePersonaMaterial(ref, material); });
}
export function savePersonaDependencies(db, kind, id, version, refs) {
    for (const ref of uniqueSources(refs))
        db.prepare('INSERT INTO persona_adoption_dependencies(owner_kind,owner_id,owner_version,source_key,body,body_hash) VALUES(?,?,?,?,?,?)')
            .run(kind, id, version, sourceKey(ref), JSON.stringify(ref), personaDigest(ref));
}
