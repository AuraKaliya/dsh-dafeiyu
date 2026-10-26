import type { HostConfig } from '#dafeiyu/contracts';
import { z } from 'zod';
/** Public configuration groups a platform's channel and capabilities together.
 * Internal extension IDs remain stable so historical source and delivery keys survive. */
export declare const BilibiliAssemblySchema: z.ZodObject<{
    capabilities: z.ZodOptional<z.ZodObject<{
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
    }, z.core.$strict>>;
    channel: z.ZodOptional<z.ZodObject<{
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
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare function normalizeHostPlugins(raw: unknown): HostConfig;
