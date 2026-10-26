import { ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { ExecutorCodeSchema, ExecutorHashSchema, ExecutorProcessSchema, executorHash } from './types.js';
/** Fixed package asset, never selected by model input or a per-job request. */
export const WINDOWS_PROCESS_PROBE_PATH = fileURLToPath(new URL('../windows/process-proof.ps1', import.meta.url));
const absolute = z.string().min(1).max(2000).refine(isAbsolute);
const sid = z.string().regex(/^S-1-(?:\d+-){1,14}\d+$/).max(184);
const processId = z.number().int().positive().max(2147483647);
const creationId = z.string().regex(/^[0-9]{1,20}$/);
export const WindowsProbeOptionsSchema = z.strictObject({ powershellPath: absolute, powershellHash: ExecutorHashSchema,
    nodePath: absolute, nodeHash: ExecutorHashSchema, probeHash: ExecutorHashSchema, temporaryDirectory: absolute,
    probeTimeoutMs: z.number().int().min(100).max(10000).optional() });
export const WindowsProcessControlOptionsSchema = WindowsProbeOptionsSchema.extend({ expectedOwnerSid: sid });
export const windowsProcessControlConfigurationHash = (raw) => executorHash(WindowsProcessControlOptionsSchema.parse(raw));
/** ownerSid is native TokenUser; admin membership is an enabled, non-deny-only token group. */
export const WindowsNativeProcessProofSchema = z.strictObject({ pid: processId, parentPid: z.number().int().nonnegative().max(2147483647),
    creationId, creationTimeUtc: z.iso.datetime({ offset: true }), executablePath: absolute, ownerSid: sid, elevated: z.boolean(),
    administratorsEnabled: z.boolean(), elevationType: z.union([z.literal(1), z.literal(2), z.literal(3)]), restricted: z.boolean(), alive: z.boolean() });
const attested = WindowsNativeProcessProofSchema.extend({ executableHash: ExecutorHashSchema });
const descendant = z.strictObject({ pid: processId, parentPid: processId, creationId, alive: z.boolean() });
const tracked = z.strictObject({ pid: processId, creationId, state: z.enum(['alive', 'exited', 'pid-reused', 'unknown']) });
const response = z.strictObject({ version: z.literal(1), kind: z.literal('result'), requestId: z.uuid(), parent: WindowsNativeProcessProofSchema,
    target: WindowsNativeProcessProofSchema.nullable(), targetError: ExecutorCodeSchema.nullable(), descendants: z.array(descendant).max(128),
    tracked: z.array(tracked).max(128), snapshotComplete: z.boolean() });
const wire = z.discriminatedUnion('kind', [
    z.strictObject({ version: z.literal(1), kind: z.literal('ready'), parent: WindowsNativeProcessProofSchema }), response,
    z.strictObject({ version: z.literal(1), kind: z.literal('fatal'), code: ExecutorCodeSchema }),
]);
export const WindowsHostProofSchema = z.strictObject({ schemaVersion: z.literal(1), observedAt: z.iso.datetime(), parent: attested,
    powershellHash: ExecutorHashSchema, probeHash: ExecutorHashSchema, scope: z.literal('current-machine-only') });
export const WindowsExecutionProofSchema = WindowsHostProofSchema.extend({ child: attested, descendants: z.array(descendant).max(128),
    snapshotComplete: z.boolean(), treeContainment: z.literal('not-enforced') });
export const WindowsTerminationEvidenceSchema = z.strictObject({ schemaVersion: z.literal(1), observedAt: z.iso.datetime(), process: ExecutorProcessSchema,
    rootIdentityRechecked: z.boolean(), rootKillAccepted: z.boolean(), rootExitObserved: z.boolean(),
    descendantsBefore: z.array(descendant).max(128), descendantsAfter: z.array(descendant).max(128), tracked: z.array(tracked).max(128),
    snapshotComplete: z.boolean(), wholeTreeVerified: z.literal(false), gap: ExecutorCodeSchema });
function immutable(value) { if (value && typeof value === 'object') {
    for (const child of Object.values(value))
        immutable(child);
    Object.freeze(value);
} return value; }
const samePath = (left, right) => resolve(left).toLowerCase() === resolve(right).toLowerCase();
async function hashFile(file) { const hash = createHash('sha256'); for await (const bytes of createReadStream(file))
    hash.update(bytes); return hash.digest('hex'); }
async function pin(file, hash) {
    try {
        if (!samePath(await realpath(file), file) || await hashFile(file) !== hash)
            throw new Error('EXECUTOR_PROGRAM_CHANGED');
    }
    catch (error) {
        if (error instanceof Error && error.message === 'EXECUTOR_PROGRAM_CHANGED')
            throw error;
        throw new Error('EXECUTOR_PROGRAM_UNAVAILABLE');
    }
}
async function pins(options) {
    if (process.platform !== 'win32')
        throw new Error('EXECUTOR_WINDOWS_REQUIRED');
    if (!/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i.test(resolve(options.powershellPath)))
        throw new Error('EXECUTOR_POWERSHELL_PATH_INVALID');
    if (!samePath(process.execPath, options.nodePath))
        throw new Error('EXECUTOR_PARENT_PROGRAM_MISMATCH');
    await Promise.all([pin(options.powershellPath, options.powershellHash), pin(options.nodePath, options.nodeHash), pin(WINDOWS_PROCESS_PROBE_PATH, options.probeHash)]);
    if (!samePath(await realpath(options.temporaryDirectory), options.temporaryDirectory) || !(await stat(options.temporaryDirectory)).isDirectory())
        throw new Error('EXECUTOR_PROBE_TEMP_INVALID');
}
function validateProgram(proof, options, expectedPid) {
    if (proof.pid !== expectedPid || !proof.alive || !samePath(proof.executablePath, options.nodePath))
        throw new Error('EXECUTOR_PROCESS_IDENTITY_CHANGED');
}
function validateToken(proof, expectedSid) {
    if (proof.ownerSid !== expectedSid)
        throw new Error('EXECUTOR_PROCESS_OWNER_MISMATCH');
    if (!proof.alive || !proof.elevated || !proof.administratorsEnabled || proof.restricted)
        throw new Error('EXECUTOR_ADMIN_TOKEN_REQUIRED');
}
function exited(child) { return child.exitCode !== null || child.signalCode !== null; }
async function waitExit(child, ms) {
    if (exited(child))
        return true;
    return new Promise(done => {
        let settled = false;
        const finish = () => { if (settled)
            return; settled = true; clearTimeout(timer); child.removeListener('exit', finish); done(exited(child)); };
        const timer = setTimeout(finish, ms);
        child.once('exit', finish);
        if (exited(child))
            finish();
    });
}
/** Preheated fixed helper. Only a bounded metadata protocol reaches stdin; stderr is discarded. */
class Probe {
    options;
    process;
    decoder = new StringDecoder('utf8');
    buffer = '';
    failure;
    closing = false;
    resolveReady;
    rejectReady;
    started = new Promise((accept, reject) => { this.resolveReady = accept; this.rejectReady = reject; });
    pending = new Map();
    constructor(options) {
        this.options = options;
        const windowsRoot = resolve(options.powershellPath).replace(/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i, '');
        this.process = spawn(options.powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WINDOWS_PROCESS_PROBE_PATH, '-OwnerProcessId', String(process.pid)], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { SystemRoot: windowsRoot, WINDIR: windowsRoot, TEMP: options.temporaryDirectory, TMP: options.temporaryDirectory, PATH: windowsRoot + '\\System32;' + windowsRoot } });
        this.process.stdout?.on('data', (bytes) => this.receive(bytes));
        this.process.stderr?.on('data', () => { });
        this.process.on('error', () => this.fail('EXECUTOR_WINDOWS_PROBE_UNAVAILABLE'));
        this.process.once('exit', () => { if (!this.closing)
            this.fail('EXECUTOR_WINDOWS_PROBE_CLOSED'); });
        this.process.stdin?.on('error', () => this.fail('EXECUTOR_WINDOWS_PROBE_CLOSED'));
        void this.started.catch(() => { });
    }
    static async open(options) {
        await pins(options);
        const probe = new Probe(options);
        let timeout;
        try {
            const parent = await Promise.race([probe.started, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('EXECUTOR_WINDOWS_PROBE_TIMEOUT')), 15000); })]);
            return { probe, parent };
        }
        catch (error) {
            await probe.close().catch(() => { });
            throw error;
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
    }
    fail(code) { if (this.failure)
        return; this.failure = code; this.rejectReady(new Error(code)); for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error(code));
    } this.pending.clear(); }
    receive(bytes) {
        if (this.failure || this.closing)
            return;
        this.buffer += this.decoder.write(bytes);
        if (Buffer.byteLength(this.buffer) > 262144) {
            this.fail('EXECUTOR_WINDOWS_PROBE_PROTOCOL');
            return;
        }
        let end;
        while ((end = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, end).trim();
            this.buffer = this.buffer.slice(end + 1);
            if (!line)
                continue;
            try {
                const value = wire.parse(JSON.parse(line));
                if (value.kind === 'fatal') {
                    this.fail(value.code);
                    return;
                }
                if (value.kind === 'ready') {
                    this.resolveReady(value.parent);
                    continue;
                }
                const pending = this.pending.get(value.requestId);
                if (!pending) {
                    this.fail('EXECUTOR_WINDOWS_PROBE_PROTOCOL');
                    return;
                }
                this.pending.delete(value.requestId);
                clearTimeout(pending.timer);
                pending.accept(value);
            }
            catch {
                this.fail('EXECUTOR_WINDOWS_PROBE_PROTOCOL');
                return;
            }
        }
    }
    inspect(pid, expectedCreationId = null, known = []) {
        if (this.failure || this.closing)
            return Promise.reject(new Error(this.failure ?? 'EXECUTOR_WINDOWS_PROBE_CLOSED'));
        if (this.pending.size >= 8)
            return Promise.reject(new Error('EXECUTOR_WINDOWS_PROBE_BUSY'));
        const requestId = randomUUID(), input = { kind: 'inspect', requestId, targetPid: processId.parse(pid), creationId: expectedCreationId, tracked: known.slice(0, 128).map(value => ({ pid: processId.parse(value.pid), creationId: creationId.parse(value.creationId) })) };
        return new Promise((accept, reject) => {
            const timer = setTimeout(() => { this.pending.delete(requestId); this.fail('EXECUTOR_WINDOWS_PROBE_TIMEOUT'); reject(new Error('EXECUTOR_WINDOWS_PROBE_TIMEOUT')); }, this.options.probeTimeoutMs ?? 1200);
            this.pending.set(requestId, { accept, reject, timer });
            try {
                this.process.stdin.write(JSON.stringify(input) + '\n');
            }
            catch {
                this.fail('EXECUTOR_WINDOWS_PROBE_CLOSED');
            }
        });
    }
    async close() {
        if (this.closing)
            return;
        this.closing = true;
        this.fail('EXECUTOR_WINDOWS_PROBE_CLOSED');
        this.process.stdin?.end();
        if (!await waitExit(this.process, 1500)) {
            try {
                this.process.kill('SIGTERM');
            }
            catch { }
            if (!await waitExit(this.process, 1000)) {
                this.process.unref();
                throw new Error('EXECUTOR_PROBE_EXIT_UNCONFIRMED');
            }
        }
    }
}
/** Observation only: no admin authorization is inferred from this result. Useful to attest the local deployment account. */
export async function inspectWindowsHost(raw) {
    const options = WindowsProbeOptionsSchema.parse(raw), { probe, parent } = await Probe.open(options);
    try {
        validateProgram(parent, options, process.pid);
        return immutable(WindowsHostProofSchema.parse({ schemaVersion: 1, observedAt: new Date().toISOString(),
            parent: { ...parent, executableHash: options.nodeHash }, powershellHash: options.powershellHash, probeHash: options.probeHash, scope: 'current-machine-only' }));
    }
    finally {
        await probe.close();
    }
}
/** Owns only the proof helper. close() must follow draining/terminating the caller's actual executor children. */
export class WindowsProcessControl {
    options;
    probe;
    initial;
    configurationHash;
    proofs = new WeakMap();
    terminations = new WeakMap();
    closed = false;
    constructor(options, probe, initial) {
        this.options = options;
        this.probe = probe;
        this.initial = initial;
        this.configurationHash = windowsProcessControlConfigurationHash(options);
    }
    static async create(raw) {
        const options = immutable(WindowsProcessControlOptionsSchema.parse(raw)), { probe, parent } = await Probe.open(options);
        try {
            validateProgram(parent, options, process.pid);
            validateToken(parent, options.expectedOwnerSid);
            const initial = immutable(WindowsHostProofSchema.parse({ schemaVersion: 1, observedAt: new Date().toISOString(), parent: { ...parent, executableHash: options.nodeHash },
                powershellHash: options.powershellHash, probeHash: options.probeHash, scope: 'current-machine-only' }));
            return new WindowsProcessControl(options, probe, initial);
        }
        catch (error) {
            await probe.close().catch(() => { });
            throw error;
        }
    }
    parentEvidence() { return this.initial; }
    childId(child) {
        if (this.closed)
            throw new Error('EXECUTOR_WINDOWS_PROBE_CLOSED');
        if (!(child instanceof ChildProcess) || child.kill !== ChildProcess.prototype.kill || !child.pid || !samePath(child.spawnfile, this.options.nodePath) || !samePath(child.spawnargs[0] ?? '', this.options.nodePath))
            throw new Error('EXECUTOR_CHILD_HANDLE_REQUIRED');
        return processId.parse(child.pid);
    }
    validateParent(parent) {
        validateProgram(parent, this.options, process.pid);
        validateToken(parent, this.options.expectedOwnerSid);
        if (parent.creationId !== this.initial.parent.creationId)
            throw new Error('EXECUTOR_PARENT_IDENTITY_CHANGED');
    }
    async prove(child) {
        const pid = this.childId(child);
        if (exited(child))
            throw new Error('EXECUTOR_PROCESS_NOT_RUNNING');
        await pins(this.options);
        const previous = this.proofs.get(child), result = await this.probe.inspect(pid, previous?.child.creationId ?? null);
        this.validateParent(result.parent);
        if (!result.target)
            throw new Error(result.targetError ?? 'EXECUTOR_PROCESS_UNAVAILABLE');
        const actual = result.target;
        validateProgram(actual, this.options, pid);
        validateToken(actual, this.options.expectedOwnerSid);
        if (actual.parentPid !== process.pid || previous && actual.creationId !== previous.child.creationId || exited(child))
            throw new Error('EXECUTOR_PROCESS_IDENTITY_CHANGED');
        const value = immutable(WindowsExecutionProofSchema.parse({ schemaVersion: 1, observedAt: new Date().toISOString(), parent: { ...result.parent, executableHash: this.options.nodeHash },
            child: { ...actual, executableHash: this.options.nodeHash }, powershellHash: this.options.powershellHash, probeHash: this.options.probeHash, scope: 'current-machine-only',
            descendants: result.descendants, snapshotComplete: result.snapshotComplete, treeContainment: 'not-enforced' }));
        this.proofs.set(child, value);
        return value;
    }
    async identify(child) { const proof = await this.prove(child); return ExecutorProcessSchema.parse({ pid: proof.child.pid, creationId: proof.child.creationId, executableHash: proof.child.executableHash }); }
    terminationEvidence(child) { return this.terminations.get(child) ?? null; }
    async terminate(child, raw) {
        const pid = this.childId(child), expected = ExecutorProcessSchema.parse(raw), prior = this.proofs.get(child);
        if (!prior || expected.pid !== pid || executorHash(expected) !== executorHash({ pid: prior.child.pid, creationId: prior.child.creationId, executableHash: prior.child.executableHash }))
            throw new Error('EXECUTOR_PROCESS_IDENTITY_CHANGED');
        let proof = prior, identityRechecked = false, accepted = false, after;
        if (!exited(child)) {
            proof = await this.prove(child);
            identityRechecked = true;
            if (proof.child.creationId !== expected.creationId)
                throw new Error('EXECUTOR_PROCESS_IDENTITY_CHANGED');
            // ChildProcess.kill uses the original spawned process handle; no numeric-PID kill or taskkill is used.
            if (!exited(child))
                accepted = child.kill('SIGTERM');
        }
        const rootExitObserved = await waitExit(child, 1000);
        try {
            after = await this.probe.inspect(pid, expected.creationId, proof.descendants);
            this.validateParent(after.parent);
        }
        catch { /* Missing follow-up proof remains unknown. */ }
        const value = immutable(WindowsTerminationEvidenceSchema.parse({ schemaVersion: 1, observedAt: new Date().toISOString(), process: expected, rootIdentityRechecked: identityRechecked,
            rootKillAccepted: accepted, rootExitObserved, descendantsBefore: proof.descendants, descendantsAfter: after?.descendants ?? [], tracked: after?.tracked ?? [],
            snapshotComplete: proof.snapshotComplete && after?.snapshotComplete === true, wholeTreeVerified: false, gap: 'EXECUTOR_PROCESS_TREE_UNCONTAINED' }));
        this.terminations.set(child, value);
        // A point-in-time descendant snapshot cannot exclude detached/racing descendants, even after a root exit.
        return { verified: false };
    }
    async close() { if (this.closed)
        return; this.closed = true; await this.probe.close(); }
}
export const createWindowsProcessControl = (options) => WindowsProcessControl.create(options);
