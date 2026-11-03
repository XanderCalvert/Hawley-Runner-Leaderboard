import { describe, expect, it } from 'vitest';
import { buildWeekRows } from '../src/index.ts';
import type { ActivityRecord, ClubConfig } from '../src/index.ts';
import hawley from '../../../config/clubs/hawley-runners.json' with { type: 'json' };

const club = hawley as ClubConfig;
const athletes = [
    { id: 1, displayName: 'Sarah K.' },
    { id: 2, displayName: 'Tom B.' },
];
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
        best5kS: null,
        ...extra,
    };
}

const rows = (activities: ActivityRecord[], weekStart = '2026-09-21') => buildWeekRows({ club, athletes, activities, weekStart });

describe('buildWeekRows', () => {
    it('totals each runner for the week only', () => {
        const [sarah] = rows([
            run(1, '2026-09-22', 5, 25),
            run(1, '2026-09-26', 10, 55),
            run(1, '2026-09-14', 8, 40), // the week before
            run(1, '2026-09-28', 8, 40), // the week after
        ]);
        expect(sarah).toMatchObject({ name: 'Sarah K.', runs: 2, distanceM: 15000, longestM: 10000, movingTimeS: 80 * 60, elevationM: 150 });
        expect(sarah?.paceSPerKm).toBeCloseTo((80 * 60) / 15);
    });

    it('leaves out runners who did not run, non-members and ineligible activities', () => {
        const result = rows([
            run(2, '2026-09-22', 5, 25, { manual: true }),
            run(2, '2026-09-23', 30, 60), // 2:00/km: a bike ride tagged as a run
            run(99, '2026-09-22', 5, 25), // not opted in
        ]);
        expect(result).toEqual([]);
    });

    it('counts virtual runs in totals but keeps them out of longest run and pace', () => {
        const [row] = rows([
            run(1, '2026-09-22', 8, 40),
            run(1, '2026-09-23', 20, 100, { sportType: 'VirtualRun', trainer: true }),
        ]);
        expect(row).toMatchObject({ runs: 2, distanceM: 28000, longestM: 8000 });
        expect(row?.paceSPerKm).toBeCloseTo(300); // 40 min over 8 km, the Zwift run ignored
    });

    it('has no pace or longest run for someone who only ran virtually', () => {
        const [row] = rows([run(1, '2026-09-22', 10, 55, { sportType: 'VirtualRun', trainer: true })]);
        expect(row).toMatchObject({ runs: 1, distanceM: 10000, longestM: 0, paceSPerKm: null });
    });

    it('carries no athlete IDs', () => {
        expect(JSON.stringify(rows([run(1, '2026-09-22', 5, 25)]))).not.toMatch(/athleteId|"id"/);
    });
});
