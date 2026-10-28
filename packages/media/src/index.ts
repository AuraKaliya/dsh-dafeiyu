export { MediaStore,MEDIA_APPLICATION_ID,MEDIA_SCHEMA_VERSION,MEDIA_TABLES } from './store.js';
export { MediaFiles } from './files.js';
export { BoundedProcess,MediaWorkerError } from './process.js';
export { MediaRangeBroker } from './range-broker.js';
export { MediaDecoder } from './decoder.js';
export { MediaService,MEDIA_ACTIONS,mediaConfigSchema } from './service.js';
import { mediaConfigSchema } from './service.js';
export const MediaPluginConfigSchema=mediaConfigSchema.omit({agentId:true,profileId:true,dataDir:true,createStore:true});
export type { Config } from './service.js';
import { MediaService } from './service.js';
import type { Config } from './service.js';
import type { Context } from '@deepseek-ai/cordis';
export const name='dafeiyu-media';
export const inject=['dafeiyu','llm'];
export function apply(ctx:Context,config:Config){new MediaService(ctx,config);}

export * from './storage-status.js';
