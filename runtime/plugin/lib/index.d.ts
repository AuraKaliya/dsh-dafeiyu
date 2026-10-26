import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "dsh-dafeiyu";
export interface Config {
    settingsFile: string;
    nodePath: string;
}
export declare const Config: Schema<Config>;
/** A dedicated process prevents the desktop DSH_HOME and agent registry from being overwritten. */
export declare function apply(ctx: Context, config: Config): import("@deepseek-ai/cordis").Disposable<Promise<void>> | undefined;
