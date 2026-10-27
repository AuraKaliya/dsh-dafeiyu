import { z } from 'zod';
import { ManagedHost } from '#dafeiyu/host';
import type { HostRuntimeOptions } from '#dafeiyu/host';
import type { InstallationSettings } from './settings.js';
declare const metadataSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    instanceId: z.ZodUUID;
    profileId: z.ZodString;
    agentId: z.ZodString;
    createdAt: z.ZodISODateTime;
    identityHash: z.ZodString;
    biliOwner: z.ZodNullable<z.ZodObject<{
        accountUid: z.ZodString;
        ownerUid: z.ZodString;
        since: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type InstallationMetadata = z.infer<typeof metadataSchema>;
/** Program-only fictional provider seam, never accepted in installation JSON. */
export interface InstallationOptions {
    readonly scripted?: boolean;
    readonly foundationTemplate?: string;
}
export declare function installationProfile(settings: InstallationSettings, meta: InstallationMetadata, foundationFile: string, settingsFile: string, options?: InstallationOptions): {
    schemaVersion: 1;
    profileId: string;
    agent: {
        id: string;
    };
    paths: {
        core: string;
        memory: string;
        sessions: string;
        query: string;
        channels: Record<string, string>;
    };
    modelRoutes: {
        chat: {
            provider: string;
            model: string;
            reasoningEffort?: string | undefined;
        };
        probes?: Partial<Record<"vision" | "asr" | "audio-events", {
            provider: string;
            model: string;
            reasoningEffort?: string | undefined;
        }>> | undefined;
    };
    plugins: {
        id: string;
        enabled: boolean;
        required: boolean;
        requires: string[];
        config: Record<string, z.core.util.JSONType>;
    }[];
    runtime: {
        maxConcurrentRuns: number;
        maxConcurrentPerTask: 1;
        maxConcurrentPerSession: 1;
        maxPendingRuns: number;
        turnTimeoutMs: number;
        phaseTimeouts: {
            assessment: number;
            render: number;
            verification: number;
            feedback: number;
        };
        shutdownGraceMs: number;
    };
    persona: {
        fixedFile: string;
        kind: "test" | "formal";
        growthRegion: {
            maxBytes: number;
            priority: number;
        };
    };
    context: {
        maxBytes: number;
        requestMaxBytes: number;
        prepareTimeoutMs: number;
        outputReserveBytes: number;
        regions: Record<string, {
            maxBytes: number;
            priority: number;
            required: boolean;
        }>;
        compactionInputTokens?: number | undefined;
    };
    authorityPolicies: {
        id: string;
        producers: string[];
        actions: string[];
        allowLocalWrite: boolean;
        sourceRules: string[];
        resources: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        }[];
        externalActions?: {
            extensionId: string;
            actionId: string;
            actionVersion: string;
        }[] | undefined;
    }[];
    diagnostics: {
        snapshotIntervalMs: number;
    };
};
export declare function prepareInstallation(settingsFile: string, options?: InstallationOptions): {
    settings: {
        schemaVersion: 1;
        dataDir: string;
        instanceName: string;
        dshTools: boolean;
        model: {
            model: string;
            credentialStore: string;
            auth?: "api-key" | "dsh-account" | undefined;
            reasoningEffort?: string | undefined;
            baseURL?: string | undefined;
            inlineTransport?: Record<string, z.core.util.JSONType> | undefined;
        };
        qq: {
            botId: string;
            ownerId: string;
            tokenFile: string;
            httpURL: string;
            wsURL: string;
            messageBatch: {
                enabled: boolean;
                quietMs: number;
                maxWaitMs: number;
                maxMessages: number;
            };
            stickers: {
                enabled: boolean;
                maxBytes: number;
                maxEntries: number;
            };
            groupIds: string[];
            joinedGroups: boolean;
            replyDelay: boolean;
            naturalNames: string[];
            media?: {
                cacheRoots: string[];
                httpsHosts: string[];
                sendEnabled: boolean;
                voiceDirectives: boolean;
            } | undefined;
        };
        activity: {
            enabled: boolean;
            timeZone: string;
            dailyActiveMs: number;
        };
        foundationFile?: string | undefined;
        bilibili?: {
            capabilities: boolean;
            session?: {
                file: string;
                expectedUid: string;
            } | undefined;
            channel?: {
                accountUid: string;
                ownerUid: string;
                sessionFile: string;
            } | undefined;
        } | undefined;
        media?: Record<string, z.core.util.JSONType> | undefined;
    };
    meta: {
        schemaVersion: 1;
        instanceId: string;
        profileId: string;
        agentId: string;
        createdAt: string;
        identityHash: string;
        biliOwner: {
            accountUid: string;
            ownerUid: string;
            since: string;
        } | null;
    };
    prepared: import("#dafeiyu/host").PreparedHostConfig;
    inspection: import("#dafeiyu/host").HostInspection;
};
export declare function startInstallation(settingsFile: string, options?: InstallationOptions, runtime?: HostRuntimeOptions): Promise<ManagedHost>;
export {};
