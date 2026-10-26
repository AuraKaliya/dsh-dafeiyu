import { z } from 'zod';
import { MediaReplyAuthoritySchema, SourceDependencySchema, PersonaSourceRefSchema } from '#dafeiyu/contracts';
export const mediaAuthorityBodySchema = MediaReplyAuthoritySchema.omit({ hash: true }).extend({ kind: z.literal('media-reply-authority'), payloadHash: z.string().length(64), inboundHash: z.string().length(64).nullable(), foundationHash: z.string().length(64),
    policy: z.strictObject({ producer: z.string(), id: z.string(), hash: z.string().length(64) }), action: z.strictObject({ owner: z.string(), id: z.string(), version: z.string(), pluginVersion: z.string(), hash: z.string().length(64) }),
    dependencies: z.array(SourceDependencySchema).max(4096), sources: z.array(PersonaSourceRefSchema).max(4096) });
