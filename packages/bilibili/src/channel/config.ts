import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { ConversationSchema } from '@dafeiyu/contracts';
import { BiliOwnerIdSchema,BILI_PUBLIC_SCENE,biliOwnerHash } from './types.js';

export const BiliOwnerPluginConfigSchema=z.strictObject({accountUid:BiliOwnerIdSchema,ownerUid:BiliOwnerIdSchema,
  pollMs:z.number().int().min(15000).max(3600000).default(30000),backoffMs:z.number().int().min(60000).max(86400000).default(900000),
  maxPagesPerTick:z.number().int().min(1).max(10).default(10),maxPending:z.number().int().min(1).max(10000).default(1000),
  tasks:z.strictObject({enabled:z.boolean().default(true),policyId:z.literal('bili-owner-task').default('bili-owner-task'),deliverResults:z.boolean().default(true),
    explorationResources:z.array(ConversationSchema).max(1).refine(values=>values.every(value=>biliOwnerHash(value)===biliOwnerHash(BILI_PUBLIC_SCENE))).default([BILI_PUBLIC_SCENE])}).prefault({})}).refine(value=>value.accountUid!==value.ownerUid,'Account and owner must differ');
export type BiliOwnerPluginConfig=z.input<typeof BiliOwnerPluginConfigSchema>;
export const BiliOwnerConfigSchema=z.strictObject({agentId:z.string().min(1).max(100),profileId:z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/),
  dataDir:z.string().min(1).refine(value=>isAbsolute(value)&&!/^[/\\]{2}/.test(value)),createStore:z.boolean().default(false),settings:BiliOwnerPluginConfigSchema});
export type BiliOwnerConfig=z.input<typeof BiliOwnerConfigSchema>;
