import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { ExtensionIdSchema, ExternalTaskAuthorizationSchema } from '#dafeiyu/contracts';
import { runtimeHash } from '#dafeiyu/core/runtime-store';
const absolutePath = z.string().min(1).max(4096).refine(value => isAbsolute(value) && !/^[/\\]{2}/.test(value), 'Expected a local absolute path');
const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/);
const unique = (values) => new Set(values).size === values.length;
export const StandingAuthoritySchema = z.strictObject({ schemaVersion: z.literal(1), id: identifier, version: z.number().int().positive(), agentId: z.string().min(1).max(100),
    producers: z.array(ExtensionIdSchema).min(1).max(32).refine(unique), policyIds: z.array(ExtensionIdSchema).min(1).max(32).refine(unique),
    actionIds: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).min(1).max(32).refine(unique), purpose: z.string().trim().min(1).max(1000),
    effectiveAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }).nullable(), revoked: z.boolean(),
    allowedWorkRoots: z.array(absolutePath).min(1).max(32).refine(unique), budgetAuthorizationId: identifier, maxExecutionMs: z.number().int().min(100).max(3600000) })
    .refine(value => value.expiresAt === null || Date.parse(value.expiresAt) > Date.parse(value.effectiveAt), 'Invalid authority interval');
export const StandingAuthorityFileSchema = z.strictObject({ path: absolutePath, configurationRoot: absolutePath, id: identifier, version: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/) });
const within = (file, root) => { const part = relative(root, file); return !part || part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part); };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function physicalDirectory(path) { try {
    const actual = realpathSync(path);
    if (!statSync(actual).isDirectory())
        throw new Error();
    return actual;
}
catch {
    throw new Error('STANDING_WORK_ROOT_UNAVAILABLE');
} }
/** Operator-owned, version/hash-pinned configuration, separate from model-managed activity plans. */
export class StandingAuthorityFile {
    clock;
    config;
    constructor(raw, clock = Date.now) {
        this.clock = clock;
        this.config = Object.freeze(StandingAuthorityFileSchema.parse(raw));
    }
    read() {
        let actual, bytes;
        try {
            const root = realpathSync(this.config.configurationRoot);
            actual = realpathSync(this.config.path);
            if (!within(actual, root) || !within(resolve(this.config.path), resolve(this.config.configurationRoot)))
                throw new Error();
            const stat = statSync(actual);
            if (!stat.isFile() || stat.size > 32768)
                throw new Error();
            bytes = readFileSync(actual);
            if (bytes.byteLength > 32768)
                throw new Error();
        }
        catch {
            throw new Error('STANDING_AUTHORITY_UNAVAILABLE');
        }
        let record;
        try {
            record = StandingAuthoritySchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
        }
        catch {
            throw new Error('STANDING_AUTHORITY_INVALID');
        }
        if (record.revoked)
            throw new Error('STANDING_AUTHORITY_REVOKED');
        const hash = digest(bytes);
        if (record.id !== this.config.id || record.version !== this.config.version || hash !== this.config.hash)
            throw new Error('STANDING_AUTHORITY_CHANGED');
        const now = this.clock();
        if (!Number.isSafeInteger(now) || now < Date.parse(record.effectiveAt) || record.expiresAt !== null && now >= Date.parse(record.expiresAt))
            throw new Error('STANDING_AUTHORITY_EXPIRED');
        return { record, hash, path: actual, roots: record.allowedWorkRoots.map(physicalDirectory) };
    }
    authorize(authority, workingDirectory) {
        authority.guard();
        const body = ExternalTaskAuthorizationSchema.parse(authority.authorization);
        if (runtimeHash(body) !== authority.hash)
            throw new Error('EXTERNAL_AUTHORITY_CHANGED');
        const source = this.read(), cwd = physicalDirectory(absolutePath.parse(workingDirectory));
        if (body.source.kind !== 'activity-wake' || body.motivation.kind !== 'self-exploration' || body.agentId !== source.record.agentId
            || !source.record.producers.includes(body.policy.producer) || !source.record.producers.includes(body.source.origin.producerId)
            || !source.record.policyIds.includes(body.policy.id) || !source.record.actionIds.includes(body.action.id) || !source.roots.some(root => within(cwd, root)))
            throw new Error('STANDING_AUTHORITY_SCOPE_DENIED');
        const expectedRoots = JSON.stringify(source.roots), expectedCoreHash = authority.hash;
        const guard = () => {
            authority.guard();
            if (authority.hash !== expectedCoreHash || runtimeHash(authority.authorization) !== expectedCoreHash)
                throw new Error('EXTERNAL_AUTHORITY_CHANGED');
            const current = this.read();
            if (current.path !== source.path || current.hash !== source.hash || JSON.stringify(current.roots) !== expectedRoots || physicalDirectory(workingDirectory) !== cwd)
                throw new Error('STANDING_AUTHORITY_CHANGED');
        };
        guard();
        return Object.freeze({ id: source.record.id, version: source.record.version, hash: source.hash, budgetAuthorizationId: source.record.budgetAuthorizationId,
            allowedWorkRoots: Object.freeze([...source.roots]), maxExecutionMs: source.record.maxExecutionMs, workingDirectory: cwd, guard });
    }
}
