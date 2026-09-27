/**
 * Plain calendar-date helpers. Everything works on 'YYYY-MM-DD' strings so that
 * weeks are bucketed by the runner's local wall-clock date, never by server time.
 * Weeks run Monday to Sunday.
 */

const DAY_MS = 86_400_000;

function toUtc(date: string): Date {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
    return fromUtc(new Date(toUtc(date).getTime() + days * DAY_MS));
}

/** Monday of the week containing the given date. */
export function weekStartOf(date: string): string {
    const day = toUtc(date).getUTCDay(); // 0 = Sunday
    const offset = (day + 6) % 7;
    return addDays(date, -offset);
}

export function weekEndOf(weekStart: string): string {
    return addDays(weekStart, 6);
}

/** Today's date in the given IANA timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}

/** The most recent fully completed week: the one you would post about on a Monday. */
export function lastCompletedWeekStart(timezone: string, now: Date = new Date()): string {
    return addDays(weekStartOf(todayIn(timezone, now)), -7);
}

export function isValidDate(date: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }
    return fromUtc(toUtc(date)) === date;
}

/** Extracts the calendar date from a Strava start_date_local value. */
export function localDateOf(startDateLocal: string): string {
    return startDateLocal.slice(0, 10);
}

/** e.g. "21–27 Sep 2026" or "29 Dec 2025 – 4 Jan 2026". */
export function formatWeekLabel(weekStart: string, locale = 'en-GB'): string {
    const start = toUtc(weekStart);
    const end = toUtc(weekEndOf(weekStart));
    const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }).format(d);

    if (start.getUTCFullYear() !== end.getUTCFullYear()) {
        const full: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
        return `${fmt(start, full)} – ${fmt(end, full)}`;
    }
    if (start.getUTCMonth() !== end.getUTCMonth()) {
        return `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return `${start.getUTCDate()}–${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
