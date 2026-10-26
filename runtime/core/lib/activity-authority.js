import { z } from 'zod';
import { ActivityAnchorSchema, PersonaSourceRefSchema, SourceDependencySchema } from '#dafeiyu/contracts';
/** This record is written only by core; the public anchor is its hashed locator. */
export const ActivityAuthoritySchema = ActivityAnchorSchema.omit({ hash: true }).extend({
    policy: z.strictObject({ producer: z.string(), id: z.string(), hash: z.string().length(64) }),
    action: z.strictObject({ owner: z.string(), id: z.string(), version: z.string(), pluginVersion: z.string(), hash: z.string().length(64) }).nullable(),
    foundationHash: z.string().length(64).nullable(),
    dependencies: z.array(SourceDependencySchema).max(4096), sources: z.array(PersonaSourceRefSchema).max(64),
});
