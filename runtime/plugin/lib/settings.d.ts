import { z } from 'zod';
export declare const InstallationSettingsSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    dataDir: z.ZodString;
    instanceName: z.ZodDefault<z.ZodString>;
    foundationFile: z.ZodOptional<z.ZodString>;
    dshTools: z.ZodDefault<z.ZodBoolean>;
    context: z.ZodOptional<z.ZodObject<{
        mode: z.ZodDefault<z.ZodEnum<{
            legacy: "legacy";
            unified: "unified";
        }>>;
        deadlineMs: z.ZodDefault<z.ZodNumber>;
        recall: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            strategy: z.ZodDefault<z.ZodEnum<{
                lexical: "lexical";
                hybrid: "hybrid";
            }>>;
            candidates: z.ZodDefault<z.ZodNumber>;
            limit: z.ZodDefault<z.ZodNumber>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
            timeoutMs: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        background: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            windowMs: z.ZodDefault<z.ZodNumber>;
            limit: z.ZodDefault<z.ZodNumber>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        recentState: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            shared: z.ZodDefault<z.ZodBoolean>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    contextBudget: z.ZodOptional<z.ZodObject<{
        maxBytes: z.ZodDefault<z.ZodNumber>;
        requestMaxBytes: z.ZodDefault<z.ZodNumber>;
        outputReserveBytes: z.ZodDefault<z.ZodNumber>;
        prepareTimeoutMs: z.ZodDefault<z.ZodNumber>;
        regions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            maxBytes: z.ZodDefault<z.ZodNumber>;
            priority: z.ZodDefault<z.ZodNumber>;
            required: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    growthMaxBytes: z.ZodOptional<z.ZodNumber>;
    localOwnerControl: z.ZodDefault<z.ZodBoolean>;
    taskTimeoutMs: z.ZodOptional<z.ZodNumber>;
    phaseTimeouts: z.ZodOptional<z.ZodPrefault<z.ZodObject<{
        assessment: z.ZodDefault<z.ZodNumber>;
        render: z.ZodDefault<z.ZodNumber>;
        verification: z.ZodDefault<z.ZodNumber>;
        feedback: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>>;
    model: z.ZodObject<{
        auth: z.ZodOptional<z.ZodEnum<{
            "api-key": "api-key";
            "dsh-account": "dsh-account";
        }>>;
        model: z.ZodString;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        credentialStore: z.ZodString;
        baseURL: z.ZodOptional<z.ZodURL>;
        inlineTransport: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    }, z.core.$strict>;
    qq: z.ZodObject<{
        botId: z.ZodString;
        ownerId: z.ZodString;
        tokenFile: z.ZodString;
        httpURL: z.ZodURL;
        wsURL: z.ZodURL;
        messageBatch: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            quietMs: z.ZodDefault<z.ZodNumber>;
            maxWaitMs: z.ZodDefault<z.ZodNumber>;
            maxMessages: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        stickers: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
            maxEntries: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        groupIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
        joinedGroups: z.ZodDefault<z.ZodBoolean>;
        replyDelay: z.ZodDefault<z.ZodBoolean>;
        naturalNames: z.ZodDefault<z.ZodArray<z.ZodString>>;
        media: z.ZodOptional<z.ZodObject<{
            cacheRoots: z.ZodDefault<z.ZodArray<z.ZodString>>;
            httpsHosts: z.ZodDefault<z.ZodArray<z.ZodString>>;
            sendEnabled: z.ZodDefault<z.ZodBoolean>;
            voiceDirectives: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    bilibili: z.ZodOptional<z.ZodObject<{
        capabilities: z.ZodDefault<z.ZodBoolean>;
        browser: z.ZodOptional<z.ZodObject<{
            expectedUid: z.ZodString;
        }, z.core.$strict>>;
        requestPolicy: z.ZodOptional<z.ZodObject<{
            minIntervalMs: z.ZodOptional<z.ZodNumber>;
            retry: z.ZodOptional<z.ZodObject<{
                rateDelaysMs: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
                riskDelayMs: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        session: z.ZodOptional<z.ZodObject<{
            file: z.ZodString;
            expectedUid: z.ZodString;
        }, z.core.$strict>>;
        channel: z.ZodOptional<z.ZodObject<{
            accountUid: z.ZodString;
            ownerUid: z.ZodString;
            sessionFile: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    media: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    activity: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        timeZone: z.ZodDefault<z.ZodString>;
        dailyActiveMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type InstallationSettings = z.infer<typeof InstallationSettingsSchema>;
export declare class SettingsError extends Error {
    readonly fields: readonly string[];
    constructor(fields: readonly string[]);
}
export declare function checkInstallationFiles(settings: InstallationSettings, scripted?: boolean): void;
/** Returns field paths only on failure. Never includes credentials or user values. */
export declare function readInstallationSettings(file: string): InstallationSettings;
