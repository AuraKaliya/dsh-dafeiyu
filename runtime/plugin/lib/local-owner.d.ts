import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { InstallationSettings } from './settings.js';
export declare const LocalOwnerRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    issuedAt: z.ZodISODateTime;
    botId: z.ZodString;
    ownerId: z.ZodString;
    text: z.ZodString;
}, z.core.$strict>;
/** Explicitly enabled, administrator-owned local ingress. It never fabricates a QQ incoming message. */
export declare function attachLocalOwnerControl(ctx: Context, settings: InstallationSettings, agentId: string): () => void;
