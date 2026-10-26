import type { ActivityScheduleBody } from '#dafeiyu/contracts';
export declare function localTime(time: number, zone: string): {
    day: string;
    minute: number;
};
export declare function quietAt(time: number, zone: string, windows: ActivityScheduleBody['quiet']): boolean;
export declare function validateQuiet(windows: ActivityScheduleBody['quiet']): void;
export declare function nextAllowed(time: number, zone: string, windows: ActivityScheduleBody['quiet']): number;
export declare function initialDue(trigger: ActivityScheduleBody['trigger']): number | null;
export declare function elapsedDue(schedule: ActivityScheduleBody, nextDue: number, now: number, toleranceMs: number): {
    due: null;
    next: number;
} | {
    due: number | null;
    next: null;
} | {
    due: number;
    next: number | null;
};
/** Split elapsed UTC time at real local-day boundaries, including DST days. */
export declare function daySlices(start: number, end: number, zone: string): {
    day: string;
    milliseconds: number;
}[];
