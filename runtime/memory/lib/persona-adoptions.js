import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PersonaRequestIdSchema, PersonaAdoptionReviewSchema, PersonaAdoptionDecisionSchema, PersonaTrialOutcomeSchema, PersonaTrialAdmissionSchema, PersonaAdoptionReviewRefSchema } from '#dafeiyu/contracts';
import { personaDigest, personaScope, sourceKey, uniqueSources } from './persona-digest.js';
import { describePersonaSources, readPersonaCandidate, readPersonaProof, savePersonaDependencies } from './persona-evidence.js';
import { evaluatePersonaAdoption, PERSONA_ADOPTION_POLICY_VERSION } from './persona-adoption-policy.js';
const fields = PersonaAdoptionReviewSchema.shape;
/** Trusted adapter input: model-facing source keys have already been resolved under the live grant. */
export const PersonaAdoptionReviewRequestSchema = z.strictObject({ requestId: PersonaRequestIdSchema, candidate: fields.candidate, trialOutcomes: fields.trialOutcomes,
    supports: fields.supports, counters: fields.counters, counterCheck: fields.counterCheck, conclusionScope: fields.conclusionScope, targetMaturity: fields.targetMaturity,
    limitations: fields.limitations, reason: fields.reason });
export class PersonaAdoptionStore {
    db;
    resolve;
    host;
    constructor(db, resolve, host) {
        this.db = db;
        this.resolve = resolve;
        this.host = host;
    }
    trialEvidence(access, review) {
        if (new Set(review.trialOutcomes.map(ref => ref.id)).size !== review.trialOutcomes.length)
            throw new Error('INVALID_INPUT');
        return review.trialOutcomes.map(ref => {
            const outcome = readPersonaProof(this.db, access, 'persona_trial_outcomes', ref, PersonaTrialOutcomeSchema);
            const admission = readPersonaProof(this.db, access, 'persona_trial_admissions', outcome.admission, PersonaTrialAdmissionSchema);
            const linked = this.db.prepare('SELECT admission_id FROM persona_trial_outcomes WHERE id=?').get(ref.id);
            if (linked?.admission_id !== admission.id)
                throw new Error('SOURCE_STALE');
            return { admission, outcome };
        });
    }
    review(access, raw) {
        const input = PersonaAdoptionReviewRequestSchema.parse(raw), candidate = readPersonaCandidate(this.db, access, input.candidate.id);
        if (candidate.version !== input.candidate.version)
            throw new Error('VERSION_CONFLICT');
        if (candidate.state !== 'trial')
            throw new Error('PERSONA_REVIEW_REQUIRED');
        const trials = this.trialEvidence(access, input), supports = uniqueSources([...candidate.supports, ...input.supports]), counters = uniqueSources([...candidate.counters, ...input.counters]);
        const checkedSources = input.counterCheck.status === 'checked-none' ? input.counterCheck.checkedSources : [];
        const dependencies = uniqueSources([candidate.contentRef, ...candidate.dependencies, ...supports, ...counters, ...checkedSources, ...access.admittedSources,
            ...access.inputs.flatMap(value => value.sourceRef ? [value.sourceRef] : []), ...trials.flatMap(({ admission, outcome }) => [admission.contentRef, ...admission.dependencies, ...outcome.sources])]);
        const sourceEvidence = describePersonaSources(access, dependencies, this.resolve);
        const { requestId: _requestId, ...bodyInput } = input;
        const body = PersonaAdoptionReviewSchema.parse({ ...bodyInput, schemaVersion: 1, id: randomUUID(), agentId: access.view.scope.agentId, scope: access.view.scope,
            runId: access.view.runId, producer: access.producer, createdAt: new Date().toISOString(), policyVersion: PERSONA_ADOPTION_POLICY_VERSION, motivation: candidate.motivation,
            supports, counters, dependencies, sourceEvidence });
        const hash = personaDigest(body);
        this.db.prepare('INSERT INTO persona_adoption_reviews(id,agent_id,scope_key,candidate_id,candidate_version,run_id,producer,body,body_hash) VALUES(?,?,?,?,?,?,?,?,?)')
            .run(body.id, body.agentId, personaScope(body.scope), body.candidate.id, body.candidate.version, body.runId, body.producer, JSON.stringify(body), hash);
        for (const outcome of body.trialOutcomes)
            this.db.prepare('INSERT INTO persona_adoption_review_outcomes(review_id,outcome_id) VALUES(?,?)').run(body.id, outcome.id);
        savePersonaDependencies(this.db, 'review', body.id, 1, dependencies);
        const decision = this.assess(access, candidate, { id: body.id, hash }, this.host.versions(access));
        this.saveDecision(access, decision);
        this.host.event(access, 'persona.adoption.reviewed', { review: { id: body.id, hash }, decision: { id: decision.id, hash: personaDigest(decision) }, eligibility: decision.eligibility, reasons: decision.reasons });
        return { review: { id: body.id, hash }, decision: { id: decision.id, hash: personaDigest(decision) }, eligibility: decision.eligibility, reasons: decision.reasons, published: false };
    }
    assess(access, candidate, raw, versions) {
        const ref = PersonaAdoptionReviewRefSchema.parse(raw), review = readPersonaProof(this.db, access, 'persona_adoption_reviews', ref, PersonaAdoptionReviewSchema);
        if (review.policyVersion !== PERSONA_ADOPTION_POLICY_VERSION)
            throw new Error('SOURCE_STALE');
        if (candidate.id !== review.candidate.id || candidate.version !== review.candidate.version)
            throw new Error('VERSION_CONFLICT');
        const links = this.db.prepare('SELECT outcome_id FROM persona_adoption_review_outcomes WHERE review_id=? ORDER BY outcome_id').all(review.id).map(row => String(row.outcome_id));
        if (personaDigest(links) !== personaDigest(review.trialOutcomes.map(value => value.id).sort()))
            throw new Error('SOURCE_STALE');
        const required = uniqueSources([candidate.contentRef, ...candidate.dependencies, ...candidate.supports, ...candidate.counters]);
        if (required.some(value => !review.dependencies.some(dependency => sourceKey(dependency) === sourceKey(value))))
            throw new Error('SOURCE_STALE');
        const sourceEvidence = describePersonaSources(access, review.dependencies, this.resolve);
        if (personaDigest(sourceEvidence) !== personaDigest(review.sourceEvidence))
            throw new Error('SOURCE_STATE_CONFLICT');
        const result = evaluatePersonaAdoption({ candidate, review, trials: this.trialEvidence(access, review), sourceEvidence, originalMotivation: candidate.motivation, scope: access.view.scope });
        return PersonaAdoptionDecisionSchema.parse({ schemaVersion: 1, id: randomUUID(), review: ref, candidate: review.candidate, agentId: access.view.scope.agentId, scope: access.view.scope,
            policyVersion: PERSONA_ADOPTION_POLICY_VERSION, checkedAt: new Date().toISOString(), ...result, dependencyHash: personaDigest({ dependencies: review.dependencies, sourceEvidence: review.sourceEvidence }),
            ...versions, targetMaturity: review.targetMaturity });
    }
    saveDecision(access, decision) {
        const parsed = PersonaAdoptionDecisionSchema.parse(decision), review = readPersonaProof(this.db, access, 'persona_adoption_reviews', parsed.review, PersonaAdoptionReviewSchema);
        this.db.prepare('INSERT INTO persona_adoption_decisions(id,review_id,agent_id,scope_key,candidate_id,candidate_version,eligibility,body,body_hash) VALUES(?,?,?,?,?,?,?,?,?)')
            .run(parsed.id, parsed.review.id, parsed.agentId, personaScope(parsed.scope), parsed.candidate.id, parsed.candidate.version, parsed.eligibility, JSON.stringify(parsed), personaDigest(parsed));
        savePersonaDependencies(this.db, 'decision', parsed.id, 1, review.dependencies);
    }
    verifyAdopted(access, candidate) {
        if (candidate.schemaVersion === 1)
            return;
        if (!candidate.adoption)
            throw new Error('PERSONA_ADOPTION_REVIEW_REQUIRED');
        const review = readPersonaProof(this.db, access, 'persona_adoption_reviews', candidate.adoption.review, PersonaAdoptionReviewSchema);
        const decision = readPersonaProof(this.db, access, 'persona_adoption_decisions', candidate.adoption.decision, PersonaAdoptionDecisionSchema);
        if (decision.eligibility !== 'allowed' || decision.reasons.length || personaDigest(decision.review) !== personaDigest(candidate.adoption.review) ||
            decision.candidate.id !== candidate.id || decision.candidate.version !== candidate.version - 1 || personaDigest(decision.candidate) !== personaDigest(review.candidate) ||
            decision.targetMaturity !== candidate.maturity || review.policyVersion !== decision.policyVersion || decision.policyVersion !== PERSONA_ADOPTION_POLICY_VERSION || candidate.policyVersion !== decision.policyVersion ||
            decision.dependencyHash !== personaDigest({ dependencies: review.dependencies, sourceEvidence: review.sourceEvidence }))
            throw new Error('SOURCE_STALE');
        const prior = readPersonaCandidate(this.db, access, candidate.id, decision.candidate.version);
        if (prior.state !== 'trial' || personaDigest(prior.contentRef) !== personaDigest(candidate.contentRef) || prior.applicability !== candidate.applicability ||
            personaDigest(prior.motivation) !== personaDigest(candidate.motivation) || personaDigest(candidate.supports) !== personaDigest(review.supports) || personaDigest(candidate.counters) !== personaDigest(review.counters) ||
            uniqueSources([...prior.dependencies, ...review.dependencies]).some(ref => !candidate.dependencies.some(value => sourceKey(value) === sourceKey(ref))))
            throw new Error('SOURCE_STALE');
        const fresh = describePersonaSources(access, review.dependencies, this.resolve);
        if (personaDigest(fresh) !== personaDigest(review.sourceEvidence))
            throw new Error('SOURCE_STATE_CONFLICT');
    }
}
