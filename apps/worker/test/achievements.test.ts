import { afterEach, describe, expect, it, vi } from 'vitest';
import { clubWeekRows } from '../src/routes/api.ts';
import { StravaClient, prEfforts } from '../src/strava.ts';
import { handleWebhookEvent, syncAthlete } from '../src/sync.ts';
import { CLUB, makeEnv, reply, seedAthlete, stravaActivity, stubStrava } from './helpers.ts';

afterEach(() => vi.unstubAllGlobals());

const effort = (name: string, distance: number, pr_rank: number | null) => ({ name, distance, elapsed_time: 1200, pr_rank });
const options = { afterEpoch: 0, detailSince: '2026-01-01', detailLimit: 0, maxPages: 1 };
const event = (id: number) => ({ object_type: 'activity' as const, object_id: id, aspect_type: 'create' as const, owner_id: 1, subscription_id: 1, event_time: 0 });

describe('personal bests from Strava', () => {
    it('keeps only efforts Strava ranks #1, at the distances we celebrate, shortest first', () => {
        const activity = stravaActivity(1, 'Run', {
            best_efforts: [
                effort('400m', 400, 1), // not a distance we show
                effort('10K', 10000, 1),
                effort('1 mile', 1609.34, 1),
                effort('5K', 5000, 2), // a good run but not a PB
                effort('1K', 1000, null),
            ],
        });
        expect(prEfforts(activity as never)).toEqual(['1 mile', '10K']);
    });

    it('stores them from the detailed activity and keeps them through a summary-only update', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        stubStrava({ 'GET /activities/55': () => reply(stravaActivity(55, 'Run', { best_efforts: [effort('5K', 5000, 1)] })) });
        await handleWebhookEvent(env, event(55));
        expect(sqlite.prepare('SELECT pr_efforts FROM activities').get()).toEqual({ pr_efforts: '5K' });

        // The hourly list call returns summaries with no best efforts: it must not wipe the PB.
        stubStrava({ 'GET /athlete/activities': () => reply([stravaActivity(55, 'Run')]) });
        await syncAthlete(env, new StravaClient(env), 1, options);
        expect(sqlite.prepare('SELECT pr_efforts FROM activities').get()).toEqual({ pr_efforts: '5K' });
    });
});

describe('lifetime total', () => {
    const base = (sqlite: ReturnType<typeof makeEnv>['sqlite']) => sqlite.prepare('SELECT lifetime_base_m AS b FROM athletes').get() as { b: number | null };

    it('stores the total minus the runs we hold, and only asks Strava weekly', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        const calls = stubStrava({
            'GET /athlete/activities': () => reply([stravaActivity(1, 'Run')]), // 5,000 m
            'GET /athletes/1/stats': () => reply({ all_run_totals: { distance: 1_000_000 } }),
        });
        await syncAthlete(env, new StravaClient(env), 1, options);
        expect(base(sqlite).b).toBe(995_000);

        await syncAthlete(env, new StravaClient(env), 1, options);
        expect(calls.filter((c) => c.path === '/athletes/1/stats')).toHaveLength(1);

        sqlite.exec("UPDATE athletes SET lifetime_checked_at = datetime('now', '-8 days')");
        await syncAthlete(env, new StravaClient(env), 1, options);
        expect(calls.filter((c) => c.path === '/athletes/1/stats')).toHaveLength(2);
    });

    it('never breaks the sync if the stats call fails', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        stubStrava({ 'GET /athlete/activities': () => reply([stravaActivity(1, 'Run')]), 'GET /athletes/1/stats': () => reply({ message: 'no' }, 403) });
        await syncAthlete(env, new StravaClient(env), 1, options);
        expect(base(sqlite).b).toBeNull();
        expect(sqlite.prepare('SELECT last_synced_at AS s FROM athletes').get()).not.toEqual({ s: null });
    });
});

describe('achievements in the week-rows endpoint', () => {
    it('reports a lifetime milestone crossed that week, with names only', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        sqlite.prepare("INSERT INTO activities (id, athlete_id, sport_type, start_date_local, distance_m, moving_time_s, pr_efforts) VALUES (1, 1, 'Run', '2026-10-20T07:30:00', 10000, 3000, '5K')").run();
        // 4,995 km before our first stored run; the 10 km run takes them past 5,000.
        sqlite.prepare('UPDATE athletes SET lifetime_base_m = 4995000, lifetime_checked_at = datetime(\'now\')').run();

        const response = await clubWeekRows(new Request(`https://w.test/x?week=2026-10-19`), env, CLUB.slug);
        const body = (await response.json()) as { achievements: { prs: unknown[]; milestones: unknown[] } };
        expect(body.achievements.milestones).toEqual([{ name: 'Sarah K.', km: 5000 }]);
        expect(body.achievements.prs).toEqual([{ name: 'Sarah K.', efforts: ['5K'] }]);
        expect(JSON.stringify(body.achievements)).not.toMatch(/athlete|Kent|"id":\d/);
    });
});
