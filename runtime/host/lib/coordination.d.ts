import { z } from 'zod';
import type { HostResource } from './paths.js';
export declare const coordinationFile: () => string;
declare const ownerSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    instanceId: z.ZodUUID;
    pid: z.ZodNumber;
    profileId: z.ZodString;
    agentId: z.ZodString;
    resources: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        identity: z.ZodString;
        kind: z.ZodEnum<{
            directory: "directory";
            file: "file";
        }>;
    }, z.core.$strict>>;
    startedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type HostOwner = z.infer<typeof ownerSchema>;
export declare function processAlive(pid: number): boolean;
export declare function owners(file?: string): HostOwner[];
export declare function conflict(resources: readonly HostResource[], file?: string): {
    schemaVersion: 1;
    instanceId: string;
    pid: number;
    profileId: string;
    agentId: string;
    resources: {
        path: string;
        identity: string;
        kind: "directory" | "file";
    }[];
    startedAt: string;
} | undefined;
export interface HostLease {
    readonly owner: HostOwner;
    release(): void;
}
/** Serializes competing claims, including directory aliases and ancestor overlaps, without deleting data. */
export declare function claim(resources: readonly HostResource[], identity: {
    profileId: string;
    agentId: string;
}, file?: string): HostLease;
export {};
