import { z } from 'zod';
import { ExternalTaskAuthorizationSchema } from './external-execution.js';
import { BiliBrowserRequestSchema } from './bili-browser.js';
export const DSH_TOOL_ACTIONS = ['dsh_tool_list', 'dsh_tool_call', 'dsh_result_read'];
export const DshToolSchema = z.strictObject({ name: z.string().min(1).max(160), description: z.string().max(32000), parameters: z.record(z.string(), z.json()) });
export const DshToolCatalogSchema = z.strictObject({ version: z.string().length(64), tools: z.array(DshToolSchema).max(256), environment: z.strictObject({ workingDirectory: z.string(), developmentDirectory: z.string(), platform: z.string() }).optional(), skills: z.array(z.strictObject({ name: z.string(), description: z.string(), load: z.json() })).max(256).optional(), skillsComplete: z.boolean().optional(), pluginChanges: z.array(z.strictObject({ id: z.uuid(), state: z.string(), updatedAt: z.iso.datetime() })).max(10).optional() });
/** Canonical program data. Array order remains semantic except named capability inventories. */
export function stableJson(value) {
    const ordered = (item) => Array.isArray(item) ? item.map(ordered) : item !== null && typeof item === 'object'
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])])) : item;
    return JSON.stringify(ordered(value));
}
export function orderedDshCatalog(value) {
    const compare = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    const parsed = DshToolCatalogSchema.parse(JSON.parse(stableJson(z.json().parse(value))));
    if (new Set(parsed.tools.map(tool => tool.name)).size !== parsed.tools.length)
        throw new Error('DSH_DUPLICATE_TOOL');
    return { ...parsed, tools: [...parsed.tools].sort(compare), ...(parsed.skills ? { skills: [...parsed.skills].sort(compare) } : {}) };
}
export const DshToolCallSchema = z.strictObject({ catalogVersion: z.string().length(64), name: z.string().min(1).max(160), argumentsJson: z.string().max(96000) });
export const DshResultReadSchema = z.strictObject({ resultId: z.uuid(), path: z.array(z.string().max(1000)).max(32).default([]), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(6000).default(4000) });
export const DshCapabilityChangeSchema = z.strictObject({ id: z.uuid(), state: z.enum(['applied', 'failed', 'restart-required', 'unknown']), authorization: ExternalTaskAuthorizationSchema, catalogVersion: z.string().length(64), toolNames: z.array(z.string().min(1).max(160)).max(256), runtimeReloaded: z.boolean() });
export const DshBridgeRequestSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('dsh.catalog'), id: z.uuid(), taskId: z.uuid().optional() }),
    z.strictObject({ type: z.literal('dsh.call'), id: z.uuid(), call: DshToolCallSchema, authorization: z.json() }),
    z.strictObject({ type: z.literal('dsh.bili-read'), id: z.uuid(), request: BiliBrowserRequestSchema }),
    z.strictObject({ type: z.literal('dsh.cancel'), id: z.uuid() }),
]);
export const DshBridgeResponseSchema = z.strictObject({ type: z.literal('dsh.result'), id: z.uuid(), value: z.json(), error: z.string().regex(/^[A-Z0-9_]{1,100}$/).optional() });
