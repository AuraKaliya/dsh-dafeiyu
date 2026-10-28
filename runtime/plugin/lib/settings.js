import { ContextAssemblySchema, ContextBudgetSchema } from '#dafeiyu/contracts';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { QqBatchConfigSchema, QqStickersConfigSchema } from '#dafeiyu/qq';
import { BiliRetryPolicySchema } from '#dafeiyu/bilibili';
import { PhaseTimeoutsSchema } from '#dafeiyu/contracts';
const path = z.string().trim().min(1).max(4096), uid = z.string().regex(/^[1-9][0-9]{0,19}$/), qq = z.string().regex(/^[1-9][0-9]{4,14}$/);
export const InstallationSettingsSchema = z.strictObject({
    schemaVersion: z.literal(1), dataDir: path, instanceName: z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/).default('dafeiyu'),
    foundationFile: path.optional(),
    dshTools: z.boolean().default(false),
    context: ContextAssemblySchema.optional(),
    contextBudget: ContextBudgetSchema.omit({ assembly: true }).optional(),
    growthMaxBytes: z.number().int().min(0).max(32000).optional(),
    localOwnerControl: z.boolean().default(false),
    taskTimeoutMs: z.number().int().min(1000).max(3600000).optional(),
    phaseTimeouts: PhaseTimeoutsSchema.optional(),
    model: z.strictObject({ auth: z.enum(['api-key', 'dsh-account']).optional(), model: z.string().trim().min(1).max(160), reasoningEffort: z.string().trim().min(1).max(40).optional(),
        credentialStore: path, baseURL: z.url().optional(), inlineTransport: z.record(z.string(), z.json()).optional() }),
    qq: z.strictObject({ botId: qq, ownerId: qq, tokenFile: path, httpURL: z.url(), wsURL: z.url(),
        messageBatch: QqBatchConfigSchema.prefault({ enabled: true }), stickers: QqStickersConfigSchema.prefault({}),
        groupIds: z.array(qq).max(10).default([]), joinedGroups: z.boolean().default(false), replyDelay: z.boolean().default(true), naturalNames: z.array(z.string().min(2).max(32)).max(16).default(['大肥鱼']),
        media: z.strictObject({ cacheRoots: z.array(path).max(8).default([]), httpsHosts: z.array(z.string()).max(16).default([]), sendEnabled: z.boolean().default(false), voiceDirectives: z.boolean().default(false) }).optional() }).refine(value => value.botId !== value.ownerId, 'Bot and owner must differ'),
    bilibili: z.strictObject({ capabilities: z.boolean().default(true),
        browser: z.strictObject({ expectedUid: uid }).optional(),
        requestPolicy: z.strictObject({ minIntervalMs: z.number().int().min(100).max(60000).optional(), retry: BiliRetryPolicySchema.optional() }).optional(),
        session: z.strictObject({ file: path, expectedUid: uid }).optional(),
        channel: z.strictObject({ accountUid: uid, ownerUid: uid, sessionFile: path }).refine(value => value.accountUid !== value.ownerUid, 'Account and owner must differ').optional() }).optional(),
    media: z.record(z.string(), z.json()).optional(),
    activity: z.strictObject({ enabled: z.boolean().default(true), timeZone: z.string().default('Asia/Shanghai'),
        dailyActiveMs: z.number().int().min(100).max(86400000).default(3600000) }).prefault({}),
}).superRefine((value, ctx) => {
    if (value.contextBudget && value.contextBudget.outputReserveBytes >= value.contextBudget.requestMaxBytes)
        ctx.addIssue({ code: 'custom', path: ['contextBudget', 'outputReserveBytes'], message: 'Output reserve must fit within the request capacity' });
    if (value.contextBudget?.regions['memory:growth'])
        ctx.addIssue({ code: 'custom', path: ['contextBudget', 'regions'], message: 'Use growthMaxBytes for personality capacity' });
    if (value.bilibili?.browser && !value.dshTools)
        ctx.addIssue({ code: 'custom', path: ['dshTools'], message: 'Bilibili browser reads require the desktop bridge' });
    if (value.bilibili && !value.bilibili.capabilities && !value.bilibili.channel)
        ctx.addIssue({ code: 'custom', path: ['bilibili'], message: 'Enable a platform interface or omit the plugin' });
    if (value.qq.media && !value.media)
        ctx.addIssue({ code: 'custom', path: ['media'], message: 'QQ media interfaces require media configuration' });
    if (value.qq.stickers.enabled && !value.media)
        ctx.addIssue({ code: 'custom', path: ['qq', 'stickers'], message: 'Stickers require media configuration' });
    if (value.media?.vision && !value.model.inlineTransport)
        ctx.addIssue({ code: 'custom', path: ['model', 'inlineTransport'], message: 'Vision requires explicit image transport configuration' });
    if (value.bilibili?.capabilities && !value.media)
        ctx.addIssue({ code: 'custom', path: ['media'], message: 'Bilibili video capabilities require media configuration' });
    if (value.bilibili?.session && value.bilibili.channel && value.bilibili.session.expectedUid !== value.bilibili.channel.accountUid)
        ctx.addIssue({ code: 'custom', path: ['bilibili', 'session', 'expectedUid'], message: 'Platform interfaces must use the same account' });
});
export class SettingsError extends Error {
    fields;
    constructor(fields) {
        super('INSTALL_CONFIGURATION_REQUIRED');
        this.fields = fields;
    }
}
export function checkInstallationFiles(settings, scripted = false) {
    const missing = [];
    const file = (path) => { try {
        const info = statSync(path);
        return info.isFile() && info.size > 0 && info.size <= 262144;
    }
    catch {
        return false;
    } };
    if (!scripted && !file(settings.model.credentialStore))
        missing.push('model.credentialStore');
    if (!file(settings.qq.tokenFile))
        missing.push('qq.tokenFile');
    else if (readFileSync(settings.qq.tokenFile, 'utf8').trim().length < 32)
        missing.push('qq.tokenFile');
    if (settings.bilibili?.channel && !file(settings.bilibili.channel.sessionFile))
        missing.push('bilibili.channel.sessionFile');
    if (settings.bilibili?.session && !file(settings.bilibili.session.file))
        missing.push('bilibili.session.file');
    if (missing.length)
        throw new SettingsError(missing);
}
/** Returns field paths only on failure. Never includes credentials or user values. */
export function readInstallationSettings(file) {
    let raw;
    try {
        const bytes = readFileSync(file);
        if (bytes.length > 262144)
            throw new Error();
        raw = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
    }
    catch {
        throw new SettingsError(['settingsFile']);
    }
    const parsed = InstallationSettingsSchema.safeParse(raw);
    if (!parsed.success)
        throw new SettingsError([...new Set(parsed.error.issues.map(issue => issue.path.join('.') || 'settings'))]);
    const settings = parsed.data, base = dirname(resolve(file)), absolute = (value) => resolve(base, value);
    settings.dataDir = absolute(settings.dataDir);
    settings.model.credentialStore = absolute(settings.model.credentialStore);
    settings.qq.tokenFile = absolute(settings.qq.tokenFile);
    if (settings.qq.media)
        settings.qq.media.cacheRoots = settings.qq.media.cacheRoots.map(absolute);
    if (settings.foundationFile)
        settings.foundationFile = absolute(settings.foundationFile);
    if (settings.bilibili?.session)
        settings.bilibili.session.file = absolute(settings.bilibili.session.file);
    if (settings.bilibili?.channel)
        settings.bilibili.channel.sessionFile = absolute(settings.bilibili.channel.sessionFile);
    // Media paths are resolved against this settings file by the profile builder.
    return settings;
}
