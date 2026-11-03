import {z} from 'zod';
import {ConversationSchema} from './conversation.js';

/** Directory previews are untrusted material, not a claim that the agent has read the resource. */
export const ExplorationCandidateSchema=z.strictObject({key:z.string().min(1).max(300),revision:z.string().min(1).max(160),provider:z.string().min(1).max(80),
  resource:ConversationSchema,reference:z.string().min(1).max(200),title:z.string().max(200),prior:z.enum(['none','read','blocked']).default('none')});
export type ExplorationCandidate=z.infer<typeof ExplorationCandidateSchema>;
export interface ExplorationCatalog {snapshot(signal:AbortSignal):Promise<readonly ExplorationCandidate[]>}
