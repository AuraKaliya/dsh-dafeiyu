import { z } from 'zod';
import type { PreparedHostConfig } from '#dafeiyu/host';
/** Fixed imports used by ManagedHost. A manifest pins them; it never chooses a module to import. */
export declare const SERVER_SDK_PACKAGES: readonly ["@deepseek-ai/cordis", "@deepseek-ai/dsh-agent", "@deepseek-ai/dsh-agent-loop", "@deepseek-ai/dsh-session", "@deepseek-ai/dsh-session-projection", "@deepseek-ai/dsh-session-persistence-jsonl", "@deepseek-ai/dsh-session-query-sqlite", "@deepseek-ai/dsh-system-prompt", "@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-credentials", "@deepseek-ai/dsh-credentials-local", "@deepseek-ai/dsh-llm-deepseek", "@deepseek-ai/dsh-llm-deepseek-api-key"];
export declare const SERVER_RUNTIME_FILES: readonly ["package.json", "bin/dafeiyu-server.mjs", "lib/index.js", "lib/cli.js", "lib/launch-config.js", "lib/launch-state.js", "lib/production.js", "lib/model-admission.js", "lib/shared-budget.js", "lib/call-gate.js", "lib/lifecycle.js", "lib/types.js", "lib/runtime-files.js"];
export declare const ServerCoordinationSchema: z.ZodObject<{
    path: z.ZodString;
    parentIdentity: z.ZodString;
}, z.core.$strict>;
export type ServerCoordination = z.infer<typeof ServerCoordinationSchema>;
export declare const ServerLaunchManifestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    host: z.ZodObject<{
        path: z.ZodString;
        fileHash: z.ZodString;
        preparedHash: z.ZodString;
    }, z.core.$strict>;
    accounting: z.ZodObject<{
        id: z.ZodString;
        profileId: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
            reasoningEffort: z.ZodNullable<z.ZodString>;
            contextWindow: z.ZodNumber;
            maxOutputTokens: z.ZodNumber;
            maxRequestBytes: z.ZodNumber;
        }, z.core.$strict>;
    }, z.core.$strict>;
    windows: z.ZodObject<{
        powershellPath: z.ZodString;
        powershellHash: z.ZodString;
        nodePath: z.ZodString;
        nodeHash: z.ZodString;
        probeHash: z.ZodString;
        temporaryDirectory: z.ZodString;
        probeTimeoutMs: z.ZodOptional<z.ZodNumber>;
        expectedOwnerSid: z.ZodString;
    }, z.core.$strict>;
    coordination: z.ZodObject<{
        path: z.ZodString;
        parentIdentity: z.ZodString;
    }, z.core.$strict>;
    biliOwner: z.ZodOptional<z.ZodObject<{
        installationRoot: z.ZodString;
        manifestPath: z.ZodString;
        manifestHash: z.ZodString;
        credentialFile: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    maximumCallMs: z.ZodNumber;
    drainTimeoutMs: z.ZodNumber;
    sdkPins: z.ZodArray<z.ZodObject<{
        name: z.ZodEnum<{
            "@deepseek-ai/cordis": "@deepseek-ai/cordis";
            "@deepseek-ai/dsh-agent": "@deepseek-ai/dsh-agent";
            "@deepseek-ai/dsh-agent-loop": "@deepseek-ai/dsh-agent-loop";
            "@deepseek-ai/dsh-session": "@deepseek-ai/dsh-session";
            "@deepseek-ai/dsh-session-projection": "@deepseek-ai/dsh-session-projection";
            "@deepseek-ai/dsh-session-persistence-jsonl": "@deepseek-ai/dsh-session-persistence-jsonl";
            "@deepseek-ai/dsh-session-query-sqlite": "@deepseek-ai/dsh-session-query-sqlite";
            "@deepseek-ai/dsh-system-prompt": "@deepseek-ai/dsh-system-prompt";
            "@deepseek-ai/dsh-tools": "@deepseek-ai/dsh-tools";
            "@deepseek-ai/dsh-llm": "@deepseek-ai/dsh-llm";
            "@deepseek-ai/dsh-credentials": "@deepseek-ai/dsh-credentials";
            "@deepseek-ai/dsh-credentials-local": "@deepseek-ai/dsh-credentials-local";
            "@deepseek-ai/dsh-llm-deepseek": "@deepseek-ai/dsh-llm-deepseek";
            "@deepseek-ai/dsh-llm-deepseek-api-key": "@deepseek-ai/dsh-llm-deepseek-api-key";
        }>;
        version: z.ZodString;
        entry: z.ZodObject<{
            path: z.ZodString;
            hash: z.ZodString;
        }, z.core.$strict>;
        package: z.ZodObject<{
            path: z.ZodString;
            hash: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    runtimePins: z.ZodArray<z.ZodObject<{
        file: z.ZodEnum<{
            "package.json": "package.json";
            "bin/dafeiyu-server.mjs": "bin/dafeiyu-server.mjs";
            "lib/index.js": "lib/index.js";
            "lib/cli.js": "lib/cli.js";
            "lib/launch-config.js": "lib/launch-config.js";
            "lib/launch-state.js": "lib/launch-state.js";
            "lib/production.js": "lib/production.js";
            "lib/model-admission.js": "lib/model-admission.js";
            "lib/shared-budget.js": "lib/shared-budget.js";
            "lib/call-gate.js": "lib/call-gate.js";
            "lib/lifecycle.js": "lib/lifecycle.js";
            "lib/types.js": "lib/types.js";
            "lib/runtime-files.js": "lib/runtime-files.js";
        }>;
        hash: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ServerLaunchManifest = z.infer<typeof ServerLaunchManifestSchema>;
export declare function resolvedServerSdkFiles(): readonly {
    name: typeof SERVER_SDK_PACKAGES[number];
    version: string;
    entry: string;
    package: string;
}[];
/** Bounded content check, including BigInt physical identity. No executable is started. */
export declare function inspectLaunchPin(value: {
    path: string;
    hash: string;
}, maximumBytes?: number): void;
export interface LaunchEnvelope {
    readonly file: string;
    readonly hash: string;
    readonly home: string;
    readonly manifest: ServerLaunchManifest;
    guard(): void;
}
/** Safe to call before importing Host. It does not resolve credentials, open databases or create a home. */
export declare function loadServerLaunchEnvelope(file: string): LaunchEnvelope;
/** Full read-only preflight, run only after the thin bin has bound DSH_HOME. */
export declare function prepareServerLaunch(envelope: LaunchEnvelope): Promise<{
    envelope: LaunchEnvelope;
    host: PreparedHostConfig;
    guard: () => void;
}>;
