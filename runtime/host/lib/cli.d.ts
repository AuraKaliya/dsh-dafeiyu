export interface HostCommand {
    mode: 'inspect' | 'init' | 'start' | 'run' | 'status' | 'migrate';
    migration?: 'plan' | 'apply' | 'verify';
    config: string;
    request?: string;
    plan?: string;
    backup?: string;
    out?: string;
}
export declare function parseHostCommand(args: readonly string[]): HostCommand;
export declare function runHostCommand(command: HostCommand, write?: (value: unknown) => void): Promise<number>;
