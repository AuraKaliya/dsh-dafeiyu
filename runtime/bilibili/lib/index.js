export { BiliConfigSchema, BiliPluginConfigSchema, BILI_SCENE } from './config.js';
export { BiliStore, BILI_APPLICATION_ID, BILI_SCHEMA_VERSION, BILI_TABLES } from './store.js';
export { BiliService, BILI_ACTIONS } from './service.js';
import { BiliService } from './service.js';
export const name = 'dafeiyu-bilibili';
export const inject = ['dafeiyu'];
export function apply(ctx, config) { new BiliService(ctx, config); }
