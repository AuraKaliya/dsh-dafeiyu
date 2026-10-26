const formatters = new Map();
function formatter(zone) { let value = formatters.get(zone); if (!value) {
    value = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, value);
} return value; }
export function localTime(time, zone) {
    const fields = Object.fromEntries(formatter(zone).formatToParts(time).map(p => [p.type, p.value]));
    return { day: `${fields.year}-${fields.month}-${fields.day}`, minute: Number(fields.hour) * 60 + Number(fields.minute) };
}
const minute = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export function quietAt(time, zone, windows) {
    const now = localTime(time, zone).minute;
    return windows.some(w => { const start = minute(w.start), end = minute(w.end); return start < end ? now >= start && now < end : now >= start || now < end; });
}
export function validateQuiet(windows) {
    const covered = new Uint8Array(1440);
    for (const w of windows) {
        const start = minute(w.start), end = minute(w.end);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 || start >= 1440 || end >= 1440 || start === end)
            throw new Error('ACTIVITY_QUIET_INVALID');
        for (let i = start; i !== end; i = (i + 1) % 1440)
            covered[i] = 1;
    }
    if (covered.every(value => value === 1))
        throw new Error('ACTIVITY_QUIET_ALL_DAY');
}
export function nextAllowed(time, zone, windows) {
    validateQuiet(windows);
    if (!quietAt(time, zone, windows))
        return time;
    // Search UTC minutes so repeated or absent local clock times cannot create duplicate slots.
    for (let next = Math.floor(time / 60000) * 60000 + 60000; next <= time + 49 * 3600000; next += 60000)
        if (!quietAt(next, zone, windows))
            return next;
    throw new Error('ACTIVITY_TIME_UNAVAILABLE');
}
export function initialDue(trigger) { return trigger.kind === 'once' ? Date.parse(trigger.at) : trigger.kind === 'interval' ? Date.parse(trigger.anchorAt) : null; }
export function elapsedDue(schedule, nextDue, now, toleranceMs) {
    if (now < nextDue)
        return { due: null, next: nextDue };
    const trigger = schedule.trigger;
    if (trigger.kind === 'condition')
        return { due: now, next: null };
    if (trigger.kind === 'once')
        return { due: schedule.missed === 'skip' && now - nextDue > toleranceMs ? null : nextDue, next: null };
    const missed = Math.floor((now - nextDue) / trigger.intervalMs), latest = nextDue + missed * trigger.intervalMs, next = latest + trigger.intervalMs;
    if (schedule.missed === 'skip' && missed > 0)
        return { due: null, next };
    return { due: latest, next: schedule.missed === 'run-once' ? null : next };
}
/** Split elapsed UTC time at real local-day boundaries, including DST days. */
export function daySlices(start, end, zone) {
    if (end < start)
        throw new Error('ACTIVITY_CLOCK_REVERSED');
    if (end - start > 8 * 86400000)
        throw new Error('ACTIVITY_DURATION_UNCERTAIN');
    const result = [];
    let from = start;
    while (from < end) {
        const day = localTime(from, zone).day;
        let boundary = end;
        if (localTime(end - 1, zone).day !== day) {
            let low = from, high = Math.min(end, from + 49 * 3600000);
            while (high - low > 1) {
                const middle = Math.floor((low + high) / 2);
                if (localTime(middle, zone).day === day)
                    low = middle;
                else
                    high = middle;
            }
            boundary = high;
        }
        result.push({ day, milliseconds: boundary - from });
        from = boundary;
    }
    return result;
}
