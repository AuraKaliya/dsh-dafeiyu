import { z } from 'zod';
import type { StorageInspection } from './storage-inspection.js';
import type { PreparedHostConfig } from './configuration.js';
export declare const ProfileManifestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    profileId: z.ZodString;
    agentId: z.ZodString;
    id: z.ZodUUID;
    state: z.ZodEnum<{
        initializing: "initializing";
        initialized: "initialized";
        failed: "failed";
    }>;
    createdAt: z.ZodISODateTime;
    paths: z.ZodRecord<z.ZodString, z.ZodString>;
    requiredStores: z.ZodArray<z.ZodString>;
    mode: z.ZodEnum<{
        init: "init";
        migrated: "migrated";
    }>;
}, z.core.$strict>;
export type ProfileManifest = z.infer<typeof ProfileManifestSchema>;
export interface HostInspection {
    readonly schemaVersion: 1;
    readonly profileId: string;
    readonly agentId: string;
    readonly configHash: string;
    readonly foundationHash: string;
    readonly ready: boolean;
    readonly canInitialize: boolean;
    readonly codes: readonly string[];
    readonly occupied: boolean;
    readonly stores: readonly (StorageInspection & {
        name: string;
    })[];
    readonly plugins: readonly {
        id: string;
        enabled: boolean;
        required: boolean;
        version: string | null;
        state: 'configured' | 'disabled';
    }[];
    readonly order: readonly string[];
}
export declare function layoutPaths(config: PreparedHostConfig): {
    [k: string]: string;
};
export declare const manifestFile: (config: PreparedHostConfig) => string;
export declare function readManifest(config: PreparedHostConfig): ProfileManifest | null;
export declare function writeManifest(config: PreparedHostConfig, value: ProfileManifest): void;
export declare function storageFiles(config: PreparedHostConfig): ({
    name: "memory" | "analysis" | "working" | "feedback" | "retrieval";
    kind: "memory" | "analysis" | "working" | "feedback" | "retrieval";
    file: string;
} | {
    name: string;
    kind: "qq";
    file: string;
} | {
    name: string;
    kind: "journal";
    file: string;
} | {
    name: string;
    kind: "runtime";
    file: string;
} | {
    name: string;
    kind: "delivery";
    file: string;
} | {
    name: string;
    kind: "activity";
    file: string;
} | {
    name: string;
    kind: "media";
    file: string;
} | {
    name: string;
    kind: "bilibili";
    file: string;
} | {
    name: string;
    kind: "executor";
    file: string;
} | {
    name: string;
    kind: "bili-owner";
    file: string;
} | {
    name: string;
    kind: "query";
    file: string;
})[];
export declare function packageVersion(id: string): string | null;
export declare function inspectHost(config: PreparedHostConfig, coordination?: string, ownInstanceId?: string): HostInspection;
export declare function initializeProfile(config: PreparedHostConfig, coordination?: string): HostInspection;
/** Only a completed explicit migration may supply an existing profile's first Host binding. */
export declare function bindMigratedProfile(config: PreparedHostConfig): void;
