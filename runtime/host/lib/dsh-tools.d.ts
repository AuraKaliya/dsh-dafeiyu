import type { Context } from '@deepseek-ai/cordis';
import type { DshToolsPort } from '#dafeiyu/contracts';
/** DSH executes once. Result reads are separate, scoped observations of immutable sanitized material. */
export declare function bindDshTools(ctx: Context, agentId: string, port: DshToolsPort, receiptDirectory: string): {
    dispose: () => void;
    ingest?: (message: unknown) => import("#dafeiyu/contracts").Receipt;
};
