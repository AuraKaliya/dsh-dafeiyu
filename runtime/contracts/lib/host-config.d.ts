import { z } from 'zod';
export declare const HostConfigSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    profileId: z.ZodString;
    agent: z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strict>;
    paths: z.ZodObject<{
        core: z.ZodString;
        memory: z.ZodString;
        sessions: z.ZodString;
        query: z.ZodString;
        channels: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strict>;
    modelRoutes: z.ZodObject<{
        chat: z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
            reasoningEffort: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        probes: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
            asr: "asr";
            vision: "vision";
            "audio-events": "audio-events";
        }> & z.core.$partial, z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
            reasoningEffort: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
    plugins: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        enabled: z.ZodDefault<z.ZodBoolean>;
        required: z.ZodDefault<z.ZodBoolean>;
        requires: z.ZodDefault<z.ZodArray<z.ZodString>>;
        config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    }, z.core.$strict>>;
    runtime: z.ZodPrefault<z.ZodObject<{
        maxConcurrentRuns: z.ZodDefault<z.ZodNumber>;
        maxConcurrentPerTask: z.ZodDefault<z.ZodLiteral<1>>;
        maxConcurrentPerSession: z.ZodDefault<z.ZodLiteral<1>>;
        maxPendingRuns: z.ZodDefault<z.ZodNumber>;
        turnTimeoutMs: z.ZodDefault<z.ZodNumber>;
        shutdownGraceMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    persona: z.ZodObject<{
        fixedFile: z.ZodString;
        kind: z.ZodEnum<{
            test: "test";
            formal: "formal";
        }>;
        growthRegion: z.ZodPrefault<z.ZodObject<{
            maxBytes: z.ZodDefault<z.ZodNumber>;
            priority: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    context: z.ZodPrefault<z.ZodObject<{
        maxBytes: z.ZodDefault<z.ZodNumber>;
        requestMaxBytes: z.ZodDefault<z.ZodNumber>;
        prepareTimeoutMs: z.ZodDefault<z.ZodNumber>;
        outputReserveBytes: z.ZodDefault<z.ZodNumber>;
        regions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            maxBytes: z.ZodDefault<z.ZodNumber>;
            priority: z.ZodDefault<z.ZodNumber>;
            required: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>>>;
        compactionInputTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    authorityPolicies: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        producers: z.ZodArray<z.ZodString>;
        actions: z.ZodArray<z.ZodString>;
        allowLocalWrite: z.ZodDefault<z.ZodBoolean>;
        externalActions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            extensionId: z.ZodString;
            actionId: z.ZodString;
            actionVersion: z.ZodString;
        }, z.core.$strict>>>;
        sourceRules: z.ZodDefault<z.ZodArray<z.ZodString>>;
        resources: z.ZodDefault<z.ZodArray<z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                local: "local";
                private: "private";
                group: "group";
            }>;
            id: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>>>;
    diagnostics: z.ZodPrefault<z.ZodObject<{
        snapshotIntervalMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type HostConfig = z.infer<typeof HostConfigSchema>;
