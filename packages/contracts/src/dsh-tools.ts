import { z } from 'zod';
import type { ExternalTaskAuthority,ExternalTaskAuthorization } from './external-execution.js';
import type { Json } from './index.js';

export const DSH_TOOL_ACTIONS=['dsh_tool_list','dsh_tool_call','dsh_result_read'] as const;
export const DshToolSchema=z.strictObject({name:z.string().min(1).max(160),description:z.string().max(32000),parameters:z.record(z.string(),z.json())});
export const DshToolCatalogSchema=z.strictObject({version:z.string().length(64),tools:z.array(DshToolSchema).max(256),pluginChanges:z.array(z.strictObject({id:z.uuid(),state:z.string(),updatedAt:z.iso.datetime()})).max(10).optional()});
export type DshToolCatalog=z.infer<typeof DshToolCatalogSchema>;
export const DshToolCallSchema=z.strictObject({catalogVersion:z.string().length(64),name:z.string().min(1).max(160),argumentsJson:z.string().max(96000)});
export type DshToolCall=z.infer<typeof DshToolCallSchema>;
export const DshResultReadSchema=z.strictObject({resultId:z.uuid(),path:z.array(z.string().max(1000)).max(32).default([]),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(6000).default(4000)});
export type DshResultRead=z.infer<typeof DshResultReadSchema>;
export interface DshToolsPort {
  catalog(signal:AbortSignal):Promise<DshToolCatalog>;
  execute(call:DshToolCall,authority:ExternalTaskAuthority,signal:AbortSignal):Promise<Json>;
}
export const DshBridgeRequestSchema=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('dsh.catalog'),id:z.uuid()}),
  z.strictObject({type:z.literal('dsh.call'),id:z.uuid(),call:DshToolCallSchema,authorization:z.json()}),
  z.strictObject({type:z.literal('dsh.cancel'),id:z.uuid()}),
]);
export const DshBridgeResponseSchema=z.strictObject({type:z.literal('dsh.result'),id:z.uuid(),value:z.json(),error:z.string().regex(/^[A-Z0-9_]{1,100}$/).optional()});
/** Authority is checked in Core before transmission; the parent still validates its data boundary. */
export type DshBridgeAuthorization=ExternalTaskAuthorization;
