import { describe, expect, it } from 'vitest';
import { buildAchievements } from '../src/index.ts';
import type { ActivityRecord, ClubConfig } from '../src/index.ts';
import hawley from '../../../config/clubs/hawley-runners.json' with { type: 'json' };

const club = hawley as ClubConfig;
const athletes = [
    { id: 1, displayName: 'Sarah K.' },
    { id: 2, displayName: 'Tom B.' },
];
let nextId = 1;

function run(athleteId: number, date: string, extra: Partial<ActivityRecord> = {}): ActivityRecord {
    return {
        id: nextId++,
        athleteId,
        sportType: 'Run',
        startDateLocal: `${date}T07:30:00`,
        distanceM: 5000,
        movingTimeS: 1500,
        elevationGainM: 20,
        manual: false,
        trainer: false,
        flagged: false,
        best5kS: null,
        ...extra,
    };
}

const WEEK = '2026-10-19'; // Mon 19 to Sun 25 Oct
const build = (activities: ActivityRecord[], lifetimeBaseM = new Map<number, number>()) =>
    buildAchievements({ club, athletes, activities, lifetimeBaseM, weekStart: WEEK });

describe('day streaks', () => {
    it('counts consecutive running days ending in the week, and ignores short ones', () => {
        const result = build([
            ...['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map((d) => run(1, d)), // 4 days
            ...['2026-10-19', '2026-10-20'].map((d) => run(2, d)), // only 2: below the minimum
        ]);
        expect(result.dayStreak.entries).toEqual([expect.objectContaining({ name: 'Sarah K.', rank: 1, value: 4, display: '4 days' })]);
    });

    it('counts a streak that started the week before, and one that rested before the weekend', () => {
        const result = build(['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'].map((d) => run(1, d)));
        expect(result.dayStreak.entries[0]?.value).toBe(4);
    });

    it('ignores ineligible runs (manual entries) and gives ties a shared place', () => {
        const days = ['2026-10-20', '2026-10-21', '2026-10-22'];
        const result = build([...days.map((d) => run(1, d)), ...days.map((d) => run(2, d)), run(2, '2026-10-19', { manual: true })]);
        expect(result.dayStreak.entries.map((e) => [e.name, e.rank, e.value])).toEqual([
            ['Sarah K.', 1, 3],
            ['Tom B.', 1, 3],
        ]);
    });
});

describe('week streaks', () => {
    it('counts consecutive weeks with a run up to and including this week', () => {
        const weekly = ['2026-09-22', '2026-09-30', '2026-10-06', '2026-10-14', '2026-10-21'].map((d) => run(1, d)); // 5 weeks
        expect(build(weekly).weekStreak.entries[0]).toMatchObject({ name: 'Sarah K.', value: 5, display: '5 weeks' });
    });

    it('is broken by a missed week and needs this week to have a run', () => {
        const gap = ['2026-09-22', '2026-09-30', '2026-10-06', '2026-10-21'].map((d) => run(1, d)); // missed 12-18 Oct
        expect(build(gap).weekStreak.entries).toEqual([]);
        const notThisWeek = ['2026-09-22', '2026-09-30', '2026-10-06', '2026-10-14'].map((d) => run(1, d));
        expect(build(notThisWeek).weekStreak.entries).toEqual([]);
    });
});

describe('personal bests', () => {
    it('lists PBs set this week, shortest first, from outdoor recorded runs only', () => {
        const result = build([
            run(1, '2026-10-20', { prEfforts: ['10K', '5K'] }),
            run(1, '2026-10-12', { prEfforts: ['1K'] }), // last week
            run(2, '2026-10-21', { prEfforts: ['5K'], sportType: 'VirtualRun', trainer: true }),
            run(2, '2026-10-22', { prEfforts: ['5K'], manual: true }),
        ]);
        expect(result.prs).toEqual([{ name: 'Sarah K.', efforts: ['5K', '10K'] }]);
    });
});

describe('lifetime milestones', () => {
    it('celebrates a step crossed during the week, once, at the highest step', () => {
        // 4,990 km before the week, then 10 km in the week: crosses 5,000.
        const result = build([run(1, '2026-10-12', { distanceM: 0 }), run(1, '2026-10-20', { distanceM: 10_000 })], new Map([[1, 4_990_000]]));
        expect(result.milestones).toEqual([{ name: 'Sarah K.', km: 5000 }]);
    });

    it('does not repeat a step crossed earlier, and skips runners with no lifetime total', () => {
        const result = build(
            [run(1, '2026-10-20', { distanceM: 10_000 }), run(2, '2026-10-20', { distanceM: 10_000 })],
            new Map([[1, 5_100_000]]),
        );
        expect(result.milestones).toEqual([]);
    });

    it('counts runs after the week as not yet run', () => {
        const result = build([run(1, '2026-10-30', { distanceM: 20_000 })], new Map([[1, 4_990_000]]));
        expect(result.milestones).toEqual([]);
    });
});

describe('who is included', () => {
    it('leaves out anyone not in the opted-in list', () => {
        const result = build(['2026-10-19', '2026-10-20', '2026-10-21'].map((d) => run(99, d, { prEfforts: ['5K'] })));
        expect(result.dayStreak.entries).toEqual([]);
        expect(result.prs).toEqual([]);
    });
});

describe('running abroad', () => {
    it('lists the countries outside the UK, busiest first, with no names or distances', () => {
        const { international } = build([
            run(1, '2026-10-20', { distanceM: 10000, country: 'GB' }),
            run(2, '2026-10-21', { distanceM: 6000 }), // unknown country counts as UK
            run(1, '2026-10-22', { distanceM: 8000, country: 'ES' }),
            run(2, '2026-10-23', { distanceM: 5000, country: 'ES' }),
            run(2, '2026-10-24', { distanceM: 9000, country: 'PT' }),
        ]);
        expect(international).toEqual({ abroad: ['ES', 'PT'] });
    });

    it('ignores treadmill, manual and virtual runs, and anything outside the week', () => {
        const { international } = build([
            run(1, '2026-10-20', { country: 'ES', trainer: true }),
            run(1, '2026-10-21', { country: 'ES', sportType: 'VirtualRun' }),
            run(1, '2026-10-12', { country: 'ES' }), // the week before
        ]);
        expect(international.abroad).toEqual([]);
    });
});
