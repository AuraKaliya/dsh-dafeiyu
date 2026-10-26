import { z } from 'zod';
export declare const TaskDeliverySubmitSchema: z.ZodObject<{
    requestId: z.ZodString;
    jobId: z.ZodUUID;
    target: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const TaskDeliveryStatusSchema: z.ZodObject<{
    deliveryId: z.ZodUUID;
}, z.core.$strict>;
export declare const DeliveryMaterialSchema: z.ZodObject<{
    jobId: z.ZodUUID;
    packetId: z.ZodUUID;
    inboundId: z.ZodUUID;
    target: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
    question: z.ZodString;
    draft: z.ZodString;
    evidence: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
    }, z.core.$strict>>;
    sourceStamp: z.ZodString;
    selectionVersion: z.ZodNumber;
    expiresAt: z.ZodString;
}, z.core.$strict>;
export type DeliveryMaterial = z.infer<typeof DeliveryMaterialSchema>;
/** Native coordinator only. This stage supports explicitly simulated channels. */
export interface TaskDeliveryControl {
    submit(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    status(input: unknown): Record<string, unknown>;
}
