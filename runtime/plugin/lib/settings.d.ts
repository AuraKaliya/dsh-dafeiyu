import { z } from 'zod';
export declare const InstallationSettingsSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    dataDir: z.ZodString;
    instanceName: z.ZodDefault<z.ZodString>;
    foundationFile: z.ZodOptional<z.ZodString>;
    model: z.ZodObject<{
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
