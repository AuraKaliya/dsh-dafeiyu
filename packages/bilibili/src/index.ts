export { BiliConfigSchema,BiliPluginConfigSchema,BILI_SCENE } from './config.js';
export { BiliStore,BILI_APPLICATION_ID,BILI_SCHEMA_VERSION,BILI_TABLES } from './store.js';
export { BiliRetryPolicySchema } from './diagnostics.js';
export { BiliService,BILI_ACTIONS } from './service.js';
export type { Config } from './service.js';
export type { HttpTransport } from './http.js';
import { BiliService } from './service.js';
import type { Config } from './service.js';
import type { Context } from '@deepseek-ai/cordis';
export const name='dafeiyu-bilibili';
export const inject=['dafeiyu'];
export function apply(ctx:Context,config:Config){new BiliService(ctx,config);}

export * from './storage-status.js';
