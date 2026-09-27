import { describe, expect, it } from 'vitest';
import {
    buildWeeklySummary,
    displayName,
    formatClock,
    formatWeekLabel,
    isEligible,
    lastCompletedWeekStart,
    weekStartOf,
} from '../src/index.ts';
import type { ActivityRecord, ClubConfig } from '../src/index.ts';
import hawley from '../../../config/clubs/hawley-runners.json' with { type: 'json' };

const club = hawley as ClubConfig;
let nextId = 1;

function run(athleteId: number, date: string, km: number, minutes: number, extra: Partial<ActivityRecord> = {}): ActivityRecord {
    return {
        id: nextId++,
        athleteId,
        sportType: 'Run',
        startDateLocal: `${date}T07:30:00`,
        distanceM: km * 1000,
        movingTimeS: minutes * 60,
        elevationGainM: 10 * km,
        manual: false,
        trainer: false,
        flagged: false,
        best5kS: km >= 5 ? Math.round((minutes * 60 * 5) / km) : null,
        best10kS: null,
        ...extra,
    };
}

const athletes = [
    { id: 1, displayName: 'Sarah K.' },
    { id: 2, displayName: 'Tom B.' },
    { id: 3, displayName: 'Priya S.' },
];

describe('dates', () => {
    it('finds the Monday of a week', () => {
        expect(weekStartOf('2026-09-27')).toBe('2026-09-21'); // Sunday
        expect(weekStartOf('2026-09-21')).toBe('2026-09-21'); // Monday
    });

    it('picks last completed week in club time', () => {
        // Sunday 23:30 UTC in late September is already Monday 00:30 in London.
        expect(lastCompletedWeekStart('Europe/London', new Date('2026-09-27T23:30:00Z'))).toBe('2026-09-21');
        expect(lastCompletedWeekStart('Europe/London', new Date('2026-09-27T12:00:00Z'))).toBe('2026-09-14');
    });

    it('labels weeks', () => {
        expect(formatWeekLabel('2026-09-21')).toBe('21–27 Sept 2026'.replace('Sept', formatMonth()));
        expect(formatWeekLabel('2025-12-29')).toContain('2025');
    });
});

function formatMonth(): string {
    // Node's ICU says "Sep" or "Sept" for en-GB depending on version; accept whichever it uses.
    return new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 8, 1)));
}

describe('eligibility', () => {
    it('rejects bike rides tagged as runs, manual entries and other sports', () => {
        expect(isEligible(run(1, '2026-09-22', 30, 60), club.rules)).toBe(false); // 2:00/km
        expect(isEligible(run(1, '2026-09-22', 5, 25, { manual: true }), club.rules)).toBe(false);
        expect(isEligible(run(1, '2026-09-22', 5, 25, { sportType: 'Walk' }), club.rules)).toBe(false);
        expect(isEligible(run(1, '2026-09-22', 5, 25), club.rules)).toBe(true);
    });
});

describe('buildWeeklySummary', () => {
    const activities = [
        run(1, '2026-09-22', 5, 22),
        run(1, '2026-09-26', 21.1, 110),
        run(2, '2026-09-23', 10, 45),
        run(2, '2026-09-27', 5, 20.5),
        run(3, '2026-09-24', 5, 30),
        run(3, '2026-09-15', 8, 48), // previous week
        run(99, '2026-09-22', 42.2, 200), // not opted in
        run(1, '2026-03-01', 480, 2600 * 60 / 60), // big YTD block for a milestone check
    ];

    const summary = buildWeeklySummary({
        club,
        athletes,
        activities,
        weekStart: '2026-09-21',
        generatedAt: new Date('2026-09-28T06:00:00Z'),
    });

    it('computes weekly group totals and ignores non-members', () => {
        expect(summary.group.week.runs).toBe(5);
        expect(summary.group.week.runners).toBe(3);
        expect(summary.group.week.distanceM).toBeCloseTo(46_100);
        expect(summary.group.previousWeek.runs).toBe(1);
    });

    it('ranks fastest 5K ascending', () => {
        const fastest = summary.awards.find((a) => a.id === 'fastest-5k');
        expect(fastest?.entries.map((e) => e.name)).toEqual(['Tom B.', 'Sarah K.', 'Priya S.']);
        expect(fastest?.entries[0]?.display).toBe(formatClock(20.5 * 60));
    });

    it('ranks longest run descending', () => {
        const longest = summary.awards.find((a) => a.id === 'longest-run');
        expect(longest?.entries[0]).toMatchObject({ name: 'Sarah K.', rank: 1, display: '21.1 km' });
    });

    it('includes YTD from 1 January and flags milestones', () => {
        expect(summary.group.ytd.runs).toBe(7);
        expect(summary.milestones).toEqual([{ athleteId: 1, name: 'Sarah K.', km: 500 }]);
    });

    it('shares podium places on a tie', () => {
        const tied = buildWeeklySummary({
            club,
            athletes,
            activities: [run(1, '2026-09-22', 5, 25), run(2, '2026-09-22', 5, 25), run(3, '2026-09-22', 5, 26)],
            weekStart: '2026-09-21',
        });
        const fastest = tied.awards.find((a) => a.id === 'fastest-5k');
        expect(fastest?.entries.map((e) => e.rank)).toEqual([1, 1, 3]);
    });

    it('caps the podium and counts extra ties', () => {
        const athletesFive = [1, 2, 3, 4, 5].map((id) => ({ id, displayName: `Runner ${id}` }));
        const tied = buildWeeklySummary({
            club,
            athletes: athletesFive,
            activities: [
                run(1, '2026-09-22', 5, 25), run(1, '2026-09-23', 5, 25), run(1, '2026-09-24', 5, 25),
                ...[2, 3, 4, 5].flatMap((id) => [run(id, '2026-09-22', 5, 25), run(id, '2026-09-23', 5, 25)]),
            ],
            weekStart: '2026-09-21',
        });
        const mostRuns = tied.awards.find((a) => a.id === 'most-runs');
        expect(mostRuns?.entries).toHaveLength(3);
        expect(mostRuns?.entries.map((e) => e.rank)).toEqual([1, 2, 2]);
        expect(mostRuns?.moreTied).toBe(2);
    });
});

describe('displayName', () => {
    it('never exposes a full surname', () => {
        expect(displayName('Sarah', 'Kent')).toBe('Sarah K.');
        expect(displayName('Sarah', '')).toBe('Sarah');
        expect(displayName(null, null)).toBe('Runner');
    });
});
