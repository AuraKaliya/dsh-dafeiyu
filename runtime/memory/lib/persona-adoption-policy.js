import { personaDigest, sourceKey } from './persona-digest.js';
/** This identity binds qualifications, not a claim that the program proved semantic truth. */
export const PERSONA_ADOPTION_POLICY_VERSION = personaDigest({
    policy: 'persona-adoption-eligibility', version: 1,
    candidate: 'exact-current-trial', scope: 'exact-original-applicability',
    use: 'admitted-closed-visible-run-not-original-self-report-or-management-receipt',
    motivation: 'original-interest-preference-habit-selection',
    maturity: 'observed-complete-support-and-counter-check-without-fixed-root-count',
    counterCheck: 'found-or-observed-complete-checked-none-for-established',
    qualificationOnly: true,
});
const emptyTextHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const reasonOrder = [
    'candidate-stale', 'scope-mismatch', 'motivation-mismatch', 'trial-evidence-missing',
    'trial-not-closed', 'trial-not-used', 'counter-evidence-unresolved', 'coverage-insufficient', 'maturity-unsupported',
];
const sameCandidate = (left, right) => left.id === right.id && left.version === right.version;
const sameScope = (left, right) => personaDigest(left) === personaDigest(right);
const managementAction = (action) => action.startsWith('dafeiyu_persona_') || action === 'dafeiyu_memory_persona_candidate';
const metadataFingerprint = (value) => personaDigest({
    ...value,
    coverage: [...new Set(value.coverage)].sort(),
    roots: [...value.roots].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
});
const observedComplete = (value) => value.nature === 'observed'
    && value.completeness === 'complete' && value.coverage.length > 0 && value.roots.length > 0
    && value.roots.every(root => root.nature === 'observed');
const hasUnknownOperation = (outcome) => outcome.operations.some(operation => operation.status === 'unknown' || operation.effects === 'unknown' || operation.completeness === 'unknown');
/**
 * Pure qualification policy over already authenticated records. The caller must verify current
 * references, hashes, permissions, source validity, and the core lifecycle certificate before entry,
 * and recheck them at commit. No caller-supplied boolean can substitute for those checks.
 */
export function evaluatePersonaAdoption(input) {
    const { candidate, review } = input;
    const reasons = new Set();
    if (candidate.state !== 'trial' || !sameCandidate(candidate, review.candidate))
        reasons.add('candidate-stale');
    if (!sameScope(candidate.scope, input.scope) || !sameScope(review.scope, input.scope)
        || candidate.agentId !== input.scope.agentId || review.agentId !== input.scope.agentId
        || review.conclusionScope !== candidate.applicability)
        reasons.add('scope-mismatch');
    if (candidate.motivation.kind !== input.originalMotivation.kind || review.motivation.kind !== input.originalMotivation.kind)
        reasons.add('motivation-mismatch');
    if (['interest', 'preference', 'habit'].includes(candidate.kind)
        && !['self-exploration', 'conversation-invitation'].includes(input.originalMotivation.kind))
        reasons.add('motivation-mismatch');
    const metadata = new Map();
    const rootNatures = new Map();
    for (const value of input.sourceEvidence) {
        const key = sourceKey(value.source), previous = metadata.get(key);
        if (previous && metadataFingerprint(previous) !== metadataFingerprint(value))
            reasons.add('coverage-insufficient');
        else if (!previous)
            metadata.set(key, value);
        for (const root of value.roots) {
            const previousNature = rootNatures.get(root.key);
            if (previousNature !== undefined && previousNature !== root.nature)
                reasons.add('coverage-insufficient');
            else
                rootNatures.set(root.key, root.nature);
        }
    }
    const uniqueRefs = (refs) => [...new Map(refs.map(ref => [sourceKey(ref), ref])).values()];
    const supports = uniqueRefs([...candidate.supports, ...review.supports]);
    const counters = uniqueRefs([...candidate.counters, ...review.counters]);
    const checkedSources = review.counterCheck.status === 'checked-none' ? review.counterCheck.checkedSources : [];
    const assessmentRefs = uniqueRefs([...supports, ...counters, ...checkedSources]);
    const requiredRefs = uniqueRefs([candidate.contentRef, ...assessmentRefs]);
    if (requiredRefs.some(ref => !metadata.has(sourceKey(ref))))
        reasons.add('coverage-insufficient');
    const assessmentMetadata = assessmentRefs.flatMap(ref => {
        const value = metadata.get(sourceKey(ref));
        return value ? [value] : [];
    });
    const retainedCounters = new Set(review.counters.map(sourceKey));
    if (candidate.counters.some(ref => !retainedCounters.has(sourceKey(ref)))
        || review.counterCheck.status === 'found' && review.counters.length === 0
        || review.counterCheck.status === 'checked-none' && checkedSources.length === 0)
        reasons.add('counter-evidence-unresolved');
    const trialsById = new Map();
    for (const trial of input.trials) {
        const previous = trialsById.get(trial.outcome.id);
        if (previous && personaDigest(previous) !== personaDigest(trial))
            reasons.add('trial-not-used');
        else if (!previous)
            trialsById.set(trial.outcome.id, trial);
    }
    const requestedOutcomes = new Map();
    for (const ref of review.trialOutcomes) {
        const previous = requestedOutcomes.get(ref.id);
        if (previous !== undefined && previous !== ref.hash)
            reasons.add('trial-evidence-missing');
        requestedOutcomes.set(ref.id, ref.hash);
    }
    if (requestedOutcomes.size === 0)
        reasons.add('trial-evidence-missing');
    const reviewedTrials = [], usableTrials = [];
    let completedResults = 0;
    for (const outcomeId of requestedOutcomes.keys()) {
        const trial = trialsById.get(outcomeId);
        if (!trial) {
            reasons.add('trial-evidence-missing');
            continue;
        }
        reviewedTrials.push(trial);
        const { admission, outcome } = trial;
        if (!sameCandidate(admission.candidate, candidate) || !sameCandidate(outcome.candidate, candidate))
            reasons.add('candidate-stale');
        if (!sameScope(admission.scope, input.scope) || !sameScope(outcome.scope, input.scope)
            || admission.agentId !== input.scope.agentId || outcome.agentId !== input.scope.agentId)
            reasons.add('scope-mismatch');
        const admittedAt = Date.parse(admission.admittedAt), closedAt = Date.parse(outcome.closedAt), reviewedAt = Date.parse(review.createdAt);
        const linked = outcome.admission.id === admission.id && admission.runId === outcome.runId
            && personaDigest(admission.selection) === personaDigest(outcome.selection)
            && admission.trialSelectionVersion === admission.selection.version;
        const admissionBeforeClosure = Number.isFinite(admittedAt) && Number.isFinite(closedAt) && admittedAt <= closedAt;
        const closureBeforeReview = Number.isFinite(closedAt) && Number.isFinite(reviewedAt) && closedAt <= reviewedAt;
        if (!linked || !admissionBeforeClosure)
            reasons.add('trial-not-used');
        if (!closureBeforeReview)
            reasons.add('trial-not-closed');
        if (outcome.terminal.state !== 'completed')
            continue;
        completedResults++;
        const replayHashes = new Set([candidate.contentRef.contentHash,
            ...admission.sourceEvidence.filter(value => value.nature === 'self-report').map(value => value.source.contentHash),
            ...outcome.operations.filter(operation => managementAction(operation.action)).map(operation => operation.outcomeHash)]);
        const resultHash = outcome.terminal.result.textHash;
        if (linked && admissionBeforeClosure && closureBeforeReview && resultHash !== emptyTextHash && !replayHashes.has(resultHash))
            usableTrials.push(trial);
    }
    if (reviewedTrials.length > 0 && completedResults === 0)
        reasons.add('trial-not-closed');
    if (completedResults > 0 && usableTrials.length === 0)
        reasons.add('trial-not-used');
    const uncertainCounter = review.counterCheck.status === 'not-obtained' || review.counterCheck.status === 'unknown';
    const uncertainTrials = reviewedTrials.some(({ outcome }) => outcome.terminal.state !== 'completed' || outcome.gaps.length > 0 || hasUnknownOperation(outcome));
    const limitedEvidence = supports.length === 0 || assessmentMetadata.some(value => !observedComplete(value));
    if ((uncertainCounter || uncertainTrials || limitedEvidence) && review.limitations.length === 0)
        reasons.add('coverage-insufficient');
    if (review.targetMaturity === 'established') {
        if (uncertainCounter)
            reasons.add('counter-evidence-unresolved');
        if (uncertainTrials)
            reasons.add('coverage-insufficient');
        const completeSupport = supports.length > 0 && supports.every(ref => {
            const value = metadata.get(sourceKey(ref));
            return value !== undefined && observedComplete(value);
        });
        const completeAssessment = assessmentRefs.every(ref => {
            const value = metadata.get(sourceKey(ref));
            return value !== undefined && observedComplete(value);
        });
        if (!completeSupport || !completeAssessment) {
            reasons.add('coverage-insufficient');
            reasons.add('maturity-unsupported');
        }
        if (review.counterCheck.status === 'checked-none' && (checkedSources.length === 0 || checkedSources.some(ref => {
            const value = metadata.get(sourceKey(ref));
            return value === undefined || !observedComplete(value);
        })))
            reasons.add('counter-evidence-unresolved');
        if (['habit', 'relationship'].includes(candidate.kind)) {
            const trialSources = new Set(usableTrials.flatMap(trial => trial.outcome.sources.map(sourceKey)));
            if (!supports.some(ref => {
                const key = sourceKey(ref), value = metadata.get(key);
                return trialSources.has(key) && value !== undefined && observedComplete(value);
            }))
                reasons.add('maturity-unsupported');
        }
    }
    const ordered = Object.freeze(reasonOrder.filter(reason => reasons.has(reason)));
    return Object.freeze({ eligibility: ordered.length ? 'held' : 'allowed', reasons: ordered });
}
