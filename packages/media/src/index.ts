export { MediaStore,MEDIA_APPLICATION_ID,MEDIA_SCHEMA_VERSION,MEDIA_TABLES } from './store.js';
export { MediaFiles } from './files.js';
export { BoundedProcess,MediaWorkerError } from './process.js';
export { MediaRangeBroker } from './range-broker.js';
export { MediaDecoder } from './decoder.js';
export { MediaService,MEDIA_ACTIONS,mediaConfigSchema } from './service.js';
export type { Config } from './service.js';
import { MediaService } from './service.js';
import type { Config } from './service.js';
import type { Context } from '@deepseek-ai/cordis';
export const name='dafeiyu-media';
export const inject=['dafeiyu','llm'];
export function apply(ctx:Context,config:Config){new MediaService(ctx,config);}
