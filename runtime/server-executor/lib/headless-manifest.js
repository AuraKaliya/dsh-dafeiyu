import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ExecutorHashSchema } from './types.js';
import { ExecutorRouteSchema } from './protocol.js';
import { HeadlessCredentialBindingSchema, inspectPinnedModelCredential } from './headless-credentials.js';
const absolute = z.string().min(1).max(2000).refine(value => isAbsolute(value) && !/^[/\\]{2}/.test(value));
const pin = z.strictObject({ path: absolute, hash: ExecutorHashSchema });
export const HEADLESS_TOOLS = ['read', 'write', 'edit', 'pwsh'];
export const HeadlessLaunchManifestSchema = z.strictObject({ schemaVersion: z.literal(1), sdkVersion: z.literal('0.2.1-rc.2'), mode: z.enum(['production', 'offline']),
    home: absolute, profileName: z.string().regex(/^dafeiyu-executor-[a-z0-9-]{1,50}$/), installAnchor: absolute,
    profileBoot: pin, appBoot: pin, launchEnvironment: pin, basePatch: pin, headlessPatch: pin, profilePackage: pin, profilePatch: pin, budgetPlugin: pin,
    runtimePins: z.array(pin).min(1).max(256), offlineProvider: pin.optional(), modelCredential: HeadlessCredentialBindingSchema.optional(), route: ExecutorRouteSchema,
    allowedTools: z.array(z.enum(HEADLESS_TOOLS)).min(1).max(HEADLESS_TOOLS.length).refine(names => new Set(names).size === names.length) })
    .superRefine((value, ctx) => {
    if ((value.mode === 'offline') !== (value.offlineProvider !== undefined))
        ctx.addIssue({ code: 'custom', message: 'Only the explicit offline profile may mount a scripted provider' });
    if (value.mode === 'offline' && (value.route.provider !== 'local-test' || value.route.model !== 'scripted') || value.mode === 'production' && value.route.provider === 'local-test')
        ctx.addIssue({ code: 'custom', message: 'The offline route is local-test/scripted and cannot be a production claim' });
    if ((value.mode === 'production') !== (value.modelCredential !== undefined))
        ctx.addIssue({ code: 'custom', message: 'Only production requires an explicit model credential binding' });
    if (value.mode === 'production' && (value.route.provider !== 'deepseek-official' || !['off', 'low', 'high', 'max'].includes(value.route.reasoningEffort ?? '')))
        ctx.addIssue({ code: 'custom', message: 'Production requires the fixed official DeepSeek route and an explicit supported reasoning effort' });
});
const samePath = (a, b) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
export const headlessFileHash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export function headlessProfilePackage() { return JSON.stringify({ name: 'dafeiyu-isolated-executor-profile', private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } } }, null, 2) + '\n'; }
/** JSON is the non-executable subset of the official YAML patch format. No user supplied patch expressions are accepted. */
export function headlessProfilePatch(manifest, manifestPath) {
    const disabled = ['session-persistence-jsonl', 'session-projection-cache', 'session-log-deepseek', 'session-telemetry-otel'];
    const patches = [...disabled.map(id => ({ id, disabled: true })), { id: 'tools', config: { mode: 'native' } },
        { id: 'agent-default-model', config: { provider: manifest.route.provider, model: manifest.route.model, ...(manifest.route.reasoningEffort === null ? {} : { reasoningEffort: manifest.route.reasoningEffort }) } },
        { id: 'tool-pwsh', config: { enableRunInBackground: false, promoteOnTimeout: false } }];
    if (manifest.offlineProvider)
        patches.push({ insert: [{ id: 'dafeiyu-executor-scripted-provider', name: pathToFileURL(manifest.offlineProvider.path).href, config: { manifestPath } }] });
    if (manifest.modelCredential) {
        const binding = manifest.modelCredential;
        patches.push({ id: 'credentials', disabled: false, config: { path: binding.credentialStore.path, watch: false } }, { id: 'llm-deepseek', disabled: false, config: { apiKeyEnv: binding.credentialName, baseURL: binding.baseURL, defaultContextWindow: manifest.route.contextWindow, maxTokens: manifest.route.maxOutputTokens,
                thinking: manifest.route.reasoningEffort === 'off' ? 'disabled' : 'enabled', reasoningEffort: manifest.route.reasoningEffort, retryPolicy: { mode: 'normal', maxRetries: 0 },
                models: [{ id: manifest.route.model, contextWindow: manifest.route.contextWindow, maxTokens: manifest.route.maxOutputTokens, inputModalities: ['text'], systemPromptUpdate: 'in-history', toolUpdate: 'in-history' }] } });
    }
    patches.push({ insert: [{ id: 'dafeiyu-executor-budget', name: pathToFileURL(manifest.budgetPlugin.path).href, ...(manifest.modelCredential ? { inject: ['credentials'] } : {}), config: { manifestPath } }] });
    return JSON.stringify(patches, null, 2) + '\n';
}
function freeze(value) { if (value && typeof value === 'object') {
    for (const child of Object.values(value))
        freeze(child);
    Object.freeze(value);
} return value; }
/** Pins public runtime files and the explicitly bound model-store fingerprint/metadata; never returns secret values. */
export async function loadPinnedHeadlessManifest(path, expectedHash) {
    absolute.parse(path);
    ExecutorHashSchema.parse(expectedHash);
    if (!samePath(realpathSync.native(path), path) || headlessFileHash(path) !== expectedHash)
        throw new Error('EXECUTOR_MANIFEST_CHANGED');
    const manifest = freeze(HeadlessLaunchManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')))), profile = join(manifest.home, 'profiles', manifest.profileName), installDir = dirname(manifest.installAnchor), packages = dirname(installDir);
    const expected = [[manifest.profilePackage.path, join(profile, 'package.json')], [manifest.profilePatch.path, join(profile, 'cordis.patch.yml')],
        [manifest.profileBoot.path, join(installDir, 'lib', 'profile-boot.js')], [manifest.appBoot.path, join(packages, 'dsh-app-boot', 'lib', 'index.js')],
        [manifest.launchEnvironment.path, join(packages, 'dsh-launch-environment', 'lib', 'index.js')], [manifest.basePatch.path, join(packages, 'dsh-base', 'cordis.patch.yml')],
        [manifest.headlessPatch.path, join(packages, 'dsh-headless', 'cordis.patch.yml')]];
    if (expected.some(([actual, wanted]) => !samePath(actual, wanted)))
        throw new Error('EXECUTOR_MANIFEST_LAYOUT');
    const named = [manifest.profileBoot, manifest.appBoot, manifest.launchEnvironment, manifest.basePatch, manifest.headlessPatch, manifest.profilePackage, manifest.profilePatch, manifest.budgetPlugin, ...(manifest.offlineProvider ? [manifest.offlineProvider] : []), ...manifest.runtimePins];
    const pins = new Map();
    for (const file of named) {
        const key = process.platform === 'win32' ? resolve(file.path).toLowerCase() : resolve(file.path), old = pins.get(key);
        if (old && old.hash !== file.hash)
            throw new Error('EXECUTOR_PIN_CONFLICT');
        pins.set(key, file);
    }
    const credentialPackages = ['dsh-credentials', 'dsh-credentials-local', 'dsh-llm-deepseek', 'dsh-llm-deepseek-api-key'];
    if (manifest.modelCredential)
        for (const name of credentialPackages)
            for (const relative of ['package.json', 'lib/index.js']) {
                const required = resolve(packages, name, relative), key = process.platform === 'win32' ? required.toLowerCase() : required;
                if (!pins.has(key))
                    throw new Error('EXECUTOR_CREDENTIAL_PROVIDER_UNPINNED');
            }
    const guard = () => {
        if (!samePath(realpathSync.native(path), path) || headlessFileHash(path) !== expectedHash)
            throw new Error('EXECUTOR_MANIFEST_CHANGED');
        if (!samePath(realpathSync.native(manifest.home), manifest.home) || !samePath(realpathSync.native(profile), profile))
            throw new Error('EXECUTOR_MANIFEST_LAYOUT');
        // No home overlays, user credential store or version exemptions may silently join this fixed profile.
        for (const forbidden of [join(manifest.home, 'cordis.patch.yml'), join(manifest.home, '.credentials.yaml'), join(profile, 'compatibility.json')])
            if (existsSync(forbidden))
                throw new Error('EXECUTOR_UNPINNED_PROFILE_INPUT');
        for (const file of pins.values()) {
            if (!samePath(realpathSync.native(file.path), file.path) || !statSync(file.path).isFile() || statSync(file.path).size > 32 * 1024 * 1024 || headlessFileHash(file.path) !== file.hash)
                throw new Error('EXECUTOR_PROGRAM_CHANGED');
        }
        const installed = z.object({ name: z.literal('@deepseek-ai/dsh'), version: z.literal('0.2.1-rc.2') }).parse(JSON.parse(readFileSync(manifest.installAnchor, 'utf8')));
        void installed;
        if (manifest.modelCredential) {
            for (const name of credentialPackages)
                z.object({ name: z.literal('@deepseek-ai/' + name), version: z.literal('0.2.1-rc.2') }).parse(JSON.parse(readFileSync(join(packages, name, 'package.json'), 'utf8')));
            inspectPinnedModelCredential(manifest.modelCredential);
        }
        if (readFileSync(manifest.profilePackage.path, 'utf8') !== headlessProfilePackage() || readFileSync(manifest.profilePatch.path, 'utf8') !== headlessProfilePatch(manifest, path))
            throw new Error('EXECUTOR_PROFILE_NOT_FIXED');
    };
    guard();
    return { manifest, allowedTools: Object.freeze([...manifest.allowedTools]), guard };
}
