import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { StandingAuthorityFileSchema } from '@dafeiyu/server-bootstrap';
import { ExecutorNodeCommandSchema } from './runner.js';
import { ExecutorIdentitySchema } from './types.js';
import { ExecutorRouteSchema } from './protocol.js';

const identifier=z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/);
const qqId=z.string().regex(/^[1-9]\d{0,19}$/);
export const ServerExecutorPluginConfigSchema=z.strictObject({
  command:ExecutorNodeCommandSchema,route:ExecutorRouteSchema,budgetAuthorizationId:identifier,
  resultOwner:z.strictObject({account:qqId,ownerId:qqId}),standingAuthority:StandingAuthorityFileSchema.optional(),
  maxExecutionMs:z.number().int().min(100).max(3600000).default(300000),
  handshakeTimeoutMs:z.number().int().min(1).max(60000).default(10000),cancelGraceMs:z.number().int().min(0).max(5000).default(500),
});
export type ServerExecutorPluginConfig=z.input<typeof ServerExecutorPluginConfigSchema>;
export const ServerExecutorConfigSchema=ExecutorIdentitySchema.extend({dataDir:z.string().min(1).refine(value=>isAbsolute(value)&&!/^[/\\]{2}/.test(value)),
  createStore:z.boolean().default(false),mode:z.enum(['production','offline']).default('production'),settings:ServerExecutorPluginConfigSchema});
export type ServerExecutorConfig=z.input<typeof ServerExecutorConfigSchema>;
export const serverExecutorScene=(profileId:string)=>({channel:'server-executor',account:profileId,kind:'local' as const,id:'results'});
