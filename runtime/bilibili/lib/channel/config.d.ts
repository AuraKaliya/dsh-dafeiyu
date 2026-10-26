import { z } from 'zod';
export declare const BiliOwnerPluginConfigSchema: z.ZodObject<{
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
export type BiliOwnerPluginConfig = z.input<typeof BiliOwnerPluginConfigSchema>;
export declare const BiliOwnerConfigSchema: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
    dataDir: z.ZodString;
    createStore: z.ZodDefault<z.ZodBoolean>;
    settings: z.ZodObject<{
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
}, z.core.$strict>;
export type BiliOwnerConfig = z.input<typeof BiliOwnerConfigSchema>;
