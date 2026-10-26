export { ActivityStore, ACTIVITY_APPLICATION_ID, ACTIVITY_SCHEMA_VERSION } from './store.js';
export { ActivityConfigSchema, ActivityConfigSchema as ActivityPluginConfigSchema } from '#dafeiyu/contracts';
export { ActivityService, ACTIVITY_ACTIONS } from './service.js';
export { validateQuiet } from './time.js';
import { ActivityService } from './service.js';
export const name = 'dafeiyu-activity';
export const inject = ['dafeiyu'];
export function apply(ctx, config) { new ActivityService(ctx, config); }
