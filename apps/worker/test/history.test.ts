import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAthleteHistory } from '../src/routes/admin.ts';
import { count, makeEnv, reply, seedAthlete, stravaActivity, stubStrava } from './helpers.ts';

afterEach(() => vi.unstubAllGlobals());

const runs = Array.from({ length: 5 }, (_, i) => stravaActivity(100 + i, 'Run', { start_date_local: `2025-0${i + 1}-10T07:30:00Z`, distance: 6000 }));
const detail = (id: number) => stravaActivity(id, 'Run', { distance: 6000, best_efforts: [{ name: '5k', distance: 5000, elapsed_time: 1400 }] });

describe('loading a runner\'s history', () => {
    it('pulls the older runs and their best efforts, reporting none left', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        stubStrava({
            'GET /athlete/activities': () => reply(runs),
            ...Object.fromEntries(runs.map((r) => [`GET /activities/${r.id}`, () => reply(detail(r.id))])),
        });

        const result = (await (await loadAthleteHistory(env, 1, '2025-01-01')).json()) as { missing: number; paused: boolean };

        expect(result).toEqual({ missing: 0, paused: false });
        expect(count(sqlite, 'activities')).toBe(5);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM activities WHERE best_5k_s = 1400').get()).toEqual({ n: 5 });
    });

    it('rejects a bad date and a runner who is not connected', async () => {
        const { env } = makeEnv();
        expect((await loadAthleteHistory(env, 1, 'last year')).status).toBe(400);
        expect((await loadAthleteHistory(env, 1, '2025-01-01')).status).toBe(404);
    });
});
