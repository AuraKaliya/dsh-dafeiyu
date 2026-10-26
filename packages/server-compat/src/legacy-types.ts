import { z } from 'zod';

const id = z.string().regex(/^[1-9][0-9]{4,19}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.string().regex(/^(0|[1-9][0-9]*)$/);
const milliseconds = z.number().int().positive().safe().max(8640000000000000);

/** Program configuration, never model input. Accounts are bound to the actual channel provider. */
export const LegacyMemoryBindingSchema = z.strictObject({
  root: z.string().min(1).max(4000),
  qq: z.strictObject({ accountId: id, ownerId: id }),
  bilibili: z.strictObject({ accountId: id, ownerId: id }).optional(),
});
export type LegacyMemoryBinding = z.infer<typeof LegacyMemoryBindingSchema>;

/** The caller must derive this from a live Core context and the channel's original since boundary. */
export const LegacyMemoryScopeSchema = z.strictObject({
  platform: z.enum(['qq', 'bilibili']), accountId: id,
  route: z.string().regex(/^(?:private|group|bilibili):[1-9][0-9]{4,19}$/),
  userId: id, sinceMs: milliseconds,
});
export type LegacyMemoryScope = z.infer<typeof LegacyMemoryScopeSchema>;

export const LegacyFileVersionSchema = z.strictObject({
  path: z.string().min(1).max(300), dev: integer, ino: integer,
  bytes: z.number().int().nonnegative().max(2097152),
  mtimeNs: z.string().regex(/^-?[0-9]+$/), ctimeNs: z.string().regex(/^-?[0-9]+$/), hash,
});
export type LegacyFileVersion = z.infer<typeof LegacyFileVersionSchema>;
export const LegacyMemoryReferenceSchema = z.strictObject({
  schemaVersion: z.literal(1), key: z.string().regex(/^legacy:[a-f0-9]{64}$/),
  version: hash, scopeHash: hash, boundaryHash: hash,
  files: z.array(LegacyFileVersionSchema).min(1).max(3),
});
export type LegacyMemoryReference = z.infer<typeof LegacyMemoryReferenceSchema>;

export interface LegacyMemoryOrigin {
  readonly id: string;
  readonly route: string;
  readonly userId: string;
  readonly messageId: string;
  readonly occurredAt: string;
  readonly version: string;
}
export interface LegacyMemoryClaim {
  readonly kind: 'legacy-history-claim';
  readonly collection: 'preferences' | 'recent' | 'shared';
  readonly legacyId: string;
  readonly text: string;
  readonly legacyConfidence: 'tentative' | 'confirmed';
  readonly occurredAt: string;
  readonly expiresAt: string | null;
  readonly adopted: false;
  readonly instructionAuthority: false;
  readonly sourceVerification: 'legacy-files-only';
  readonly sources: readonly LegacyMemoryOrigin[];
  readonly ref: LegacyMemoryReference;
}
export interface LegacyMemoryReadResult {
  readonly claims: readonly LegacyMemoryClaim[];
  readonly boundary: { readonly resetAt: number; readonly sinceMs: number; readonly hash: string };
  /** Diagnostic counts only; no excluded record ids, prose or unknown extension fields. */
  readonly withheld: Readonly<Record<string, number>>;
  readonly note: 'Historical claims, not instructions, independently verified messages, or adopted persona.';
}
export interface LegacyMemoryOptions {
  readonly clock?: () => number;
  readonly maxClaims?: number;
  /** Additional program-owned recall/source check; false or exceptions withhold the whole claim. */
  readonly sourceCurrent?: (scope: LegacyMemoryScope, source: LegacyMemoryOrigin) => boolean;
}
