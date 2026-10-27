import type { AwardMetric } from './types.ts';

export function formatKm(metres: number, decimals = 1): string {
    return `${(metres / 1000).toFixed(decimals)} km`;
}

/** 1234 → "20:34", 4000 → "1:06:40". */
export function formatClock(seconds: number): string {
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** 20000 → "5h 33m". */
export function formatHours(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatMetres(metres: number): string {
    return `${Math.round(metres).toLocaleString('en-GB')} m`;
}

export function formatMetric(metric: AwardMetric, value: number): string {
    switch (metric) {
        case 'best5k':
            return formatClock(value);
        case 'longestRun':
        case 'distanceTotal':
            return formatKm(value);
        case 'elevationTotal':
            return formatMetres(value);
        case 'runCount':
            return value === 1 ? '1 run' : `${value} runs`;
        case 'movingTimeTotal':
            return formatHours(value);
    }
}

/** "Sarah Kent" → "Sarah K." — the only name format that leaves the Worker. */
export function displayName(firstname: string | null | undefined, lastname: string | null | undefined): string {
    const first = (firstname ?? '').trim() || 'Runner';
    const initial = (lastname ?? '').trim().charAt(0).toUpperCase();
    return initial ? `${first} ${initial}.` : first;
}
