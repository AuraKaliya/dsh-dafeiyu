export { ActivityStore,ACTIVITY_APPLICATION_ID,ACTIVITY_SCHEMA_VERSION } from './store.js';
export { ActivityConfigSchema } from '@dafeiyu/contracts';
export { ActivityService,ACTIVITY_ACTIONS } from './service.js';
export type { Config } from './service.js';
import { ActivityService } from './service.js';
import type { Config } from './service.js';
import type { Context } from '@deepseek-ai/cordis';
export const name='dafeiyu-activity';
export const inject=['dafeiyu'];
export function apply(ctx:Context,config:Config){new ActivityService(ctx,config);}
