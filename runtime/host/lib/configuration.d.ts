import { z } from 'zod';
import type { HostConfig } from '#dafeiyu/contracts';
import type { HostResource } from './paths.js';
export declare const DeepSeekConfigSchema: z.ZodObject<{
    credentialStore: z.ZodDefault<z.ZodString>;
    credentialName: z.ZodDefault<z.ZodLiteral<"DEEPSEEK_API_KEY">>;
    baseURL: z.ZodDefault<z.ZodURL>;
    inlineTransport: z.ZodOptional<z.ZodObject<{
        contextWindow: z.ZodNumber;
        maxOutputTokens: z.ZodNumber;
        streamIdleTimeoutMs: z.ZodDefault<z.ZodNumber>;
        maxInlineImageBytes: z.ZodDefault<z.ZodNumber>;
        maxImages: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ScriptedConfigSchema: z.ZodObject<{
    response: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const TimelineConfigSchema: z.ZodObject<{
    maxPageChars: z.ZodDefault<z.ZodNumber>;
    previewChars: z.ZodDefault<z.ZodNumber>;
    execution: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export declare const SimulatorConfigSchema: z.ZodObject<{
    account: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const pluginSchemas: {
    readonly timeline: z.ZodObject<{
        maxPageChars: z.ZodDefault<z.ZodNumber>;
        previewChars: z.ZodDefault<z.ZodNumber>;
        execution: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>;
    readonly memory: z.ZodObject<{
        maintenance: z.ZodOptional<z.ZodObject<{
            timeoutMs: z.ZodDefault<z.ZodNumber>;
            maxInputBytes: z.ZodDefault<z.ZodNumber>;
            maxOutputBytes: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        analysis: z.ZodOptional<z.ZodObject<{
            timeoutMs: z.ZodDefault<z.ZodNumber>;
            maxPending: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        feedback: z.ZodOptional<z.ZodObject<{
            maxArchiveBytes: z.ZodDefault<z.ZodNumber>;
            maxBriefBytes: z.ZodDefault<z.ZodNumber>;
            maxPageChars: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        context: z.ZodOptional<z.ZodObject<{}, z.core.$strict>>;
        retrieval: z.ZodOptional<z.ZodObject<{
            endpoint: z.ZodURL;
            python: z.ZodString;
            modelDir: z.ZodString;
            serviceFile: z.ZodString;
            pythonPackages: z.ZodOptional<z.ZodString>;
            profileFile: z.ZodOptional<z.ZodString>;
            timeoutMs: z.ZodDefault<z.ZodNumber>;
            maxDocuments: z.ZodDefault<z.ZodNumber>;
            maxChunks: z.ZodDefault<z.ZodNumber>;
            maxCacheEntries: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        compaction: z.ZodOptional<z.ZodPipe<z.ZodObject<{
            inputTokens: z.ZodNumber;
            thresholdRatio: z.ZodDefault<z.ZodNumber>;
            targetRatio: z.ZodDefault<z.ZodNumber>;
            minGrowthTokens: z.ZodDefault<z.ZodNumber>;
            minSavingsTokens: z.ZodDefault<z.ZodNumber>;
            cooldownMs: z.ZodDefault<z.ZodNumber>;
            retainTurns: z.ZodDefault<z.ZodNumber>;
            maxSourceBytes: z.ZodDefault<z.ZodNumber>;
            maxSummaryChars: z.ZodDefault<z.ZodNumber>;
            summaryMaxOutputTokens: z.ZodDefault<z.ZodNumber>;
            maxFragmentGroups: z.ZodDefault<z.ZodNumber>;
            maxFragments: z.ZodDefault<z.ZodNumber>;
            initialMaxGroups: z.ZodOptional<z.ZodNumber>;
            initialMaxFragments: z.ZodOptional<z.ZodNumber>;
            semanticEnabled: z.ZodDefault<z.ZodBoolean>;
            semanticMaxConsecutive: z.ZodDefault<z.ZodNumber>;
            semanticMaxOutputTokens: z.ZodDefault<z.ZodNumber>;
            timeoutMs: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>, z.ZodTransform<{
            initialMaxGroups: number;
            initialMaxFragments: number;
            inputTokens: number;
            thresholdRatio: number;
            targetRatio: number;
            minGrowthTokens: number;
            minSavingsTokens: number;
            cooldownMs: number;
            retainTurns: number;
            maxSourceBytes: number;
            maxSummaryChars: number;
            summaryMaxOutputTokens: number;
            maxFragmentGroups: number;
            maxFragments: number;
            semanticEnabled: boolean;
            semanticMaxConsecutive: number;
            semanticMaxOutputTokens: number;
            timeoutMs: number;
        }, {
            inputTokens: number;
            thresholdRatio: number;
            targetRatio: number;
            minGrowthTokens: number;
            minSavingsTokens: number;
            cooldownMs: number;
            retainTurns: number;
            maxSourceBytes: number;
            maxSummaryChars: number;
            summaryMaxOutputTokens: number;
            maxFragmentGroups: number;
            maxFragments: number;
            semanticEnabled: boolean;
            semanticMaxConsecutive: number;
            semanticMaxOutputTokens: number;
            timeoutMs: number;
            initialMaxGroups?: number | undefined;
            initialMaxFragments?: number | undefined;
        }>>>;
        sourceTracking: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>;
    readonly activity: z.ZodObject<{
        tickMs: z.ZodDefault<z.ZodNumber>;
        minIntervalMs: z.ZodDefault<z.ZodNumber>;
        maxPlans: z.ZodDefault<z.ZodNumber>;
        maxConcurrent: z.ZodDefault<z.ZodNumber>;
        maxActiveMs: z.ZodDefault<z.ZodNumber>;
        dailyActiveMs: z.ZodDefault<z.ZodNumber>;
        backoffBaseMs: z.ZodDefault<z.ZodNumber>;
        maxBackoffMs: z.ZodDefault<z.ZodNumber>;
        timeZone: z.ZodDefault<z.ZodString>;
        quiet: z.ZodDefault<z.ZodArray<z.ZodObject<{
            start: z.ZodString;
            end: z.ZodString;
        }, z.core.$strict>>>;
        explorationPolicy: z.ZodDefault<z.ZodString>;
        maintenancePolicy: z.ZodDefault<z.ZodString>;
        maintenance: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>;
    readonly media: z.ZodObject<{
        audio: import("zod").ZodOptional<import("zod").ZodObject<{
            whisper: import("zod").ZodOptional<import("zod").ZodObject<{
                node: import("zod").ZodString;
                moduleDirectory: import("zod").ZodString;
                moduleVersion: import("zod").ZodLiteral<"1.1.3">;
                model: import("zod").ZodObject<{
                    path: import("zod").ZodString;
                    sha256: import("zod").ZodString;
                }, import("zod/v4/core").$strict>;
                language: import("zod").ZodDefault<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>>;
            events: import("zod").ZodOptional<import("zod").ZodObject<{
                python: import("zod").ZodString;
                model: import("zod").ZodObject<{
                    path: import("zod").ZodString;
                    sha256: import("zod").ZodString;
                }, import("zod/v4/core").$strict>;
                labels: import("zod").ZodObject<{
                    path: import("zod").ZodString;
                    sha256: import("zod").ZodString;
                }, import("zod/v4/core").$strict>;
                onnxruntimeVersion: import("zod").ZodString;
                numpyVersion: import("zod").ZodString;
            }, import("zod/v4/core").$strict>>;
        }, import("zod/v4/core").$strict>>;
        ffmpeg: import("zod").ZodString;
        ffprobe: import("zod").ZodString;
        maxBytes: import("zod").ZodDefault<import("zod").ZodNumber>;
        maxAssetBytes: import("zod").ZodDefault<import("zod").ZodNumber>;
        timeoutMs: import("zod").ZodDefault<import("zod").ZodNumber>;
        vision: import("zod").ZodOptional<import("zod").ZodObject<{
            provider: import("zod").ZodString;
            model: import("zod").ZodString;
            reasoningEffort: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>>;
        documents: import("zod").ZodOptional<import("zod").ZodObject<{
            python: import("zod").ZodString;
            pypdfVersion: import("zod").ZodLiteral<"6.10.0">;
        }, import("zod/v4/core").$strict>>;
        tts: import("zod").ZodOptional<import("zod").ZodObject<{
            powershell: import("zod").ZodString;
            voice: import("zod").ZodString;
        }, import("zod/v4/core").$strict>>;
    }, z.core.$strict>;
    readonly bilibili: z.ZodObject<{
        minIntervalMs: z.ZodDefault<z.ZodNumber>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        backoffMs: z.ZodDefault<z.ZodNumber>;
        maxResponseBytes: z.ZodDefault<z.ZodNumber>;
        maxMediaReadBytes: z.ZodDefault<z.ZodNumber>;
        maxPages: z.ZodDefault<z.ZodNumber>;
        session: z.ZodOptional<z.ZodObject<{
            file: z.ZodString;
            expectedUid: z.ZodString;
        }, z.core.$strict>>;
        topics: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
    readonly 'server-executor': z.ZodObject<{
        command: z.ZodObject<{
            nodePath: z.ZodString;
            entryPath: z.ZodString;
            cwd: z.ZodString;
            args: z.ZodArray<z.ZodString>;
            nodeHash: z.ZodString;
            entryHash: z.ZodString;
            profilePath: z.ZodString;
            profileHash: z.ZodString;
            env: z.ZodObject<{
                SystemRoot: z.ZodOptional<z.ZodString>;
                WINDIR: z.ZodOptional<z.ZodString>;
                PATH: z.ZodOptional<z.ZodString>;
                TEMP: z.ZodOptional<z.ZodString>;
                TMP: z.ZodOptional<z.ZodString>;
                DSH_PERMISSION_MODE: z.ZodOptional<z.ZodLiteral<"danger-full-access">>;
                DSH_HOME: z.ZodOptional<z.ZodString>;
                DSH_TELEMETRY_DISABLED: z.ZodOptional<z.ZodLiteral<"1">>;
            }, z.core.$strict>;
        }, z.core.$strict>;
        route: z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
            reasoningEffort: z.ZodNullable<z.ZodString>;
            contextWindow: z.ZodNumber;
            maxOutputTokens: z.ZodNumber;
            maxRequestBytes: z.ZodNumber;
        }, z.core.$strict>;
        budgetAuthorizationId: z.ZodString;
        resultOwner: z.ZodObject<{
            account: z.ZodString;
            ownerId: z.ZodString;
        }, z.core.$strict>;
        standingAuthority: z.ZodOptional<z.ZodObject<{
            path: z.ZodString;
            configurationRoot: z.ZodString;
            id: z.ZodString;
            version: z.ZodNumber;
            hash: z.ZodString;
        }, z.core.$strict>>;
        maxExecutionMs: z.ZodDefault<z.ZodNumber>;
        handshakeTimeoutMs: z.ZodDefault<z.ZodNumber>;
        cancelGraceMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>;
    readonly 'channel-qq': z.ZodObject<{
        media: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            sendEnabled: z.ZodDefault<z.ZodBoolean>;
            cacheRoots: z.ZodDefault<z.ZodArray<z.ZodString>>;
            httpsHosts: z.ZodDefault<z.ZodArray<z.ZodString>>;
            maxReadBytes: z.ZodDefault<z.ZodNumber>;
            voiceDirectives: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>>;
        botId: z.ZodString;
        ownerId: z.ZodString;
        groupIds: z.ZodArray<z.ZodString>;
        naturalNames: z.ZodDefault<z.ZodArray<z.ZodString>>;
        groupSync: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            mode: z.ZodDefault<z.ZodEnum<{
                allowlist: "allowlist";
                joined: "joined";
            }>>;
            intervalMs: z.ZodDefault<z.ZodNumber>;
            maxStaleMs: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        capabilities: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            snapshotTtlMs: z.ZodDefault<z.ZodNumber>;
            maxSnapshots: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        tasks: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            deliverResults: z.ZodDefault<z.ZodBoolean>;
            policyId: z.ZodDefault<z.ZodString>;
            explorationResources: z.ZodOptional<z.ZodArray<z.ZodObject<{
                channel: z.ZodString;
                account: z.ZodString;
                kind: z.ZodEnum<{
                    private: "private";
                    group: "group";
                    local: "local";
                }>;
                id: z.ZodString;
            }, z.core.$strict>>>;
            expressionPolicy: z.ZodOptional<z.ZodObject<{
                id: z.ZodString;
                version: z.ZodNumber;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        httpURL: z.ZodString;
        wsURL: z.ZodString;
        tokenFile: z.ZodString;
        requestTimeoutMs: z.ZodDefault<z.ZodNumber>;
        reconnectMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>;
    readonly 'channel-bili-owner': z.ZodObject<{
        accountUid: z.ZodString;
        ownerUid: z.ZodString;
        pollMs: z.ZodDefault<z.ZodNumber>;
        backoffMs: z.ZodDefault<z.ZodNumber>;
        maxPagesPerTick: z.ZodDefault<z.ZodNumber>;
        maxPending: z.ZodDefault<z.ZodNumber>;
        tasks: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            policyId: z.ZodDefault<z.ZodLiteral<"bili-owner-task">>;
            deliverResults: z.ZodDefault<z.ZodBoolean>;
            explorationResources: z.ZodDefault<z.ZodArray<z.ZodObject<{
                channel: z.ZodString;
                account: z.ZodString;
                kind: z.ZodEnum<{
                    private: "private";
                    group: "group";
                    local: "local";
                }>;
                id: z.ZodString;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    readonly 'channel-simulator': z.ZodObject<{
        account: z.ZodDefault<z.ZodString>;
    }, z.core.$strict>;
    readonly 'model-deepseek': z.ZodObject<{
        credentialStore: z.ZodDefault<z.ZodString>;
        credentialName: z.ZodDefault<z.ZodLiteral<"DEEPSEEK_API_KEY">>;
        baseURL: z.ZodDefault<z.ZodURL>;
        inlineTransport: z.ZodOptional<z.ZodObject<{
            contextWindow: z.ZodNumber;
            maxOutputTokens: z.ZodNumber;
            streamIdleTimeoutMs: z.ZodDefault<z.ZodNumber>;
            maxInlineImageBytes: z.ZodDefault<z.ZodNumber>;
            maxImages: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    readonly 'model-scripted': z.ZodObject<{
        response: z.ZodDefault<z.ZodString>;
    }, z.core.$strict>;
};
export declare const BILI_OWNER_NATIVE_ACTIONS: readonly ["bili_discover", "bili_search_sources", "bili_search", "bili_video", "bili_comments", "bili_subtitles", "bili_danmaku", "bili_media", "bili_observe_select", "dafeiyu_media_acquire", "dafeiyu_media_inspect", "dafeiyu_media_read", "dafeiyu_media_select", "dafeiyu_execution_source_open", "dafeiyu_execution_contribute", "dafeiyu_execution_select", "dafeiyu_execution_source_state", "dafeiyu_task_intent", "dafeiyu_task_object"];
export type PluginId = keyof typeof pluginSchemas;
export interface PreparedPlugin {
    readonly id: PluginId;
    readonly enabled: boolean;
    readonly required: boolean;
    readonly requires: readonly string[];
    readonly config: Record<string, unknown>;
}
export interface PreparedHostConfig {
    readonly file: string;
    readonly config: HostConfig;
    readonly hash: string;
    readonly foundation: {
        hash: string;
        identity: string;
    };
    readonly paths: {
        core: string;
        memory: string;
        sessions: string;
        query: string;
        channels: Readonly<Record<string, string>>;
        foundation: string;
    };
    readonly plugins: readonly PreparedPlugin[];
    readonly order: readonly string[];
    readonly resources: readonly HostResource[];
    readonly declarations: readonly {
        path: string;
        identity: string;
    }[];
}
export declare function assertPaths(prepared: PreparedHostConfig): void;
export declare function loadHostConfig(input: string): PreparedHostConfig;
export declare function pluginConfig<P extends PluginId>(prepared: PreparedHostConfig, id: P): z.output<(typeof pluginSchemas)[P]> | undefined;
