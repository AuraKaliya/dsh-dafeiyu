/** Admission slots shared by foreground conversations and native runs. No call-count cap. */
export declare class RunScheduler {
    private readonly limit;
    private used;
    private readonly queue;
    constructor(limit: number);
    acquire(foreground: boolean): Promise<() => void>;
    private pump;
    get status(): {
        active: number;
        waiting: number;
        foregroundWaiting: number;
    };
}
