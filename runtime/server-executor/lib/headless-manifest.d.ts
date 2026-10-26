import { z } from 'zod';
export declare const HEADLESS_TOOLS: readonly ["read", "write", "edit", "pwsh"];
export declare const HeadlessLaunchManifestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    sdkVersion: z.ZodLiteral<"0.2.1-rc.2">;
    mode: z.ZodEnum<{
        production: "production";
        offline: "offline";
    }>;
    home: z.ZodString;
    profileName: z.ZodString;
    installAnchor: z.ZodString;
    profileBoot: z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>;
    appBoot: z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>;
    launchEnvironment: z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>;
    basePatch: z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>;
    headlessPatch: z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>;
    profilePackage: z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>;
    profilePatch: z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>;
    budgetPlugin: z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>;
    runtimePins: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>>;
    offlineProvider: z.ZodOptional<z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>>;
    modelCredential: z.ZodOptional<z.ZodObject<{
        credentialStore: z.ZodObject<{
            path: z.ZodString;
            hash: z.ZodString;
        }, z.core.$strict>;
        credentialName: z.ZodLiteral<"DEEPSEEK_API_KEY">;
        baseURL: z.ZodURL;
    }, z.core.$strict>>;
    route: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodNullable<z.ZodString>;
        contextWindow: z.ZodNumber;
        maxOutputTokens: z.ZodNumber;
        maxRequestBytes: z.ZodNumber;
    }, z.core.$strict>;
    allowedTools: z.ZodArray<z.ZodEnum<{
        read: "read";
        write: "write";
        edit: "edit";
        pwsh: "pwsh";
    }>>;
}, z.core.$strict>;
export type HeadlessLaunchManifest = z.infer<typeof HeadlessLaunchManifestSchema>;
export interface PinnedHeadlessManifest {
    readonly manifest: Readonly<HeadlessLaunchManifest>;
    readonly allowedTools: readonly string[];
    guard(): void;
}
export declare const headlessFileHash: (path: string) => string;
export declare function headlessProfilePackage(): string;
/** JSON is the non-executable subset of the official YAML patch format. No user supplied patch expressions are accepted. */
export declare function headlessProfilePatch(manifest: HeadlessLaunchManifest, manifestPath: string): string;
/** Pins public runtime files and the explicitly bound model-store fingerprint/metadata; never returns secret values. */
export declare function loadPinnedHeadlessManifest(path: string, expectedHash: string): Promise<PinnedHeadlessManifest>;
