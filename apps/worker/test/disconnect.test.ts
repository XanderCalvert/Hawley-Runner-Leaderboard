import { afterEach, describe, expect, it, vi } from 'vitest';
import { signState } from '../src/crypto.ts';
import { disconnectAthlete } from '../src/disconnect.ts';
import { authCallback } from '../src/routes/auth.ts';
import { StravaClient } from '../src/strava.ts';
import { handleWebhookEvent } from '../src/sync.ts';
import { CLUB, count, makeEnv, reply, seedAthlete, stravaActivity, stubStrava, tokenResponse } from './helpers.ts';

afterEach(() => vi.unstubAllGlobals());

/** Two connected runners (athlete 1 is hidden), with three stored runs between them. */
async function seedEverything() {
    const ctx = makeEnv();
    await seedAthlete(ctx.repo, 1);
    await seedAthlete(ctx.repo, 2, { firstname: 'Tom', lastname: 'Barker' });
    for (const [id, athlete] of [[10, 1], [11, 1], [12, 2]] as const) {
        ctx.sqlite
            .prepare("INSERT INTO activities (id, athlete_id, sport_type, start_date_local, distance_m, moving_time_s) VALUES (?, ?, 'Run', '2026-09-22T07:00:00', 5000, 1500)")
            .run(id, athlete);
    }
    await ctx.repo.setHidden(CLUB.slug, 1, true);
    return ctx;
}

const scalar = (sqlite: ReturnType<typeof makeEnv>['sqlite'], sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;

describe('disconnect', () => {
    it('deletes every row about the athlete and leaves everyone else alone', async () => {
        const { env, repo, sqlite } = await seedEverything();
        stubStrava({ 'POST /oauth/revoke': () => reply(null) });

        await disconnectAthlete(repo, new StravaClient(env), 1);

        expect(scalar(sqlite, 'SELECT COUNT(*) AS n FROM athletes WHERE id = 1')).toBe(0);
        expect(scalar(sqlite, 'SELECT COUNT(*) AS n FROM memberships WHERE athlete_id = 1')).toBe(0);
        expect(scalar(sqlite, 'SELECT COUNT(*) AS n FROM activities WHERE athlete_id = 1')).toBe(0);
        expect(count(sqlite, 'athletes')).toBe(1);
        expect(count(sqlite, 'activities')).toBe(1);
    });

    it('keeps only the hide list (club + athlete ID), which survives a reconnect', async () => {
        const { env, repo, sqlite } = await seedEverything();
        stubStrava({ 'POST /oauth/revoke': () => reply(null) });
        await disconnectAthlete(repo, new StravaClient(env), 1);

        expect(sqlite.prepare('SELECT club_slug, athlete_id FROM hidden').all()).toEqual([{ club_slug: CLUB.slug, athlete_id: 1 }]);

        await seedAthlete(repo, 1); // reconnects
        expect((await repo.activeAthletes(CLUB.slug)).map((a) => a.id)).toEqual([2]);
    });

    it('holds no full surname, anywhere', async () => {
        const { sqlite } = await seedEverything();
        const dump = JSON.stringify(sqlite.prepare('SELECT * FROM athletes').all());
        expect(dump).not.toMatch(/Kent|Barker/);
        expect(dump).toMatch(/"lastname_initial":"K"/);
    });

    it('revokes with HTTP Basic auth and a form body, hinting the token type', async () => {
        const { env, repo } = await seedEverything();
        const calls = stubStrava({ 'POST /oauth/revoke': () => reply(null) });
        await disconnectAthlete(repo, new StravaClient(env), 1);
        const [call] = calls;
        expect(call?.url).toBe('https://www.strava.com/oauth/revoke');
        expect(call?.headers.get('Authorization')).toBe(`Basic ${btoa('12345:client-secret')}`);
        expect(call?.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
        expect(Object.fromEntries(new URLSearchParams(call?.body))).toEqual({ token: 'refresh-1', token_type_hint: 'refresh_token' });
    });

    it('retries a 503 from revoke, and still deletes the data if revoke keeps failing', async () => {
        const { env, repo, sqlite } = await seedEverything();
        let attempts = 0;
        stubStrava({ 'POST /oauth/revoke': () => (++attempts < 2 ? reply(null, 503) : reply(null)) });
        await disconnectAthlete(repo, new StravaClient(env), 1);
        expect(attempts).toBe(2);

        stubStrava({ 'POST /oauth/revoke': () => reply({ message: 'Authorization Error' }, 401) });
        await disconnectAthlete(repo, new StravaClient(env), 2);
        expect(count(sqlite, 'athletes')).toBe(0);
        expect(count(sqlite, 'activities')).toBe(0);
    });

    it('"Remove my data" deletes everything and revokes the fresh token as well', async () => {
        const { env, sqlite } = await seedEverything();
        const calls = stubStrava({ 'POST /oauth/token': () => reply(tokenResponse(9, 6 * 3600, 2)), 'POST /oauth/revoke': () => reply(null) });
        const state = await signState(env.APP_SECRET, { club: CLUB.slug, intent: 'leave', iat: Date.now() });
        const response = await authCallback(
            new Request(`https://worker.test/auth/callback?code=c&state=${encodeURIComponent(state)}`),
            env,
            { waitUntil() {} } as unknown as ExecutionContext,
        );
        expect(new URL(response.headers.get('Location') ?? '').searchParams.get('status')).toBe('left');
        expect(scalar(sqlite, 'SELECT COUNT(*) AS n FROM athletes WHERE id = 2')).toBe(0);
        expect(scalar(sqlite, 'SELECT COUNT(*) AS n FROM activities WHERE athlete_id = 2')).toBe(0);
        expect(calls.filter((c) => c.path === '/oauth/revoke')).toHaveLength(2);
    });

    it('deletes everything on the deauthorisation webhook, without calling Strava', async () => {
        const { env, sqlite } = await seedEverything();
        const calls = stubStrava({});
        await handleWebhookEvent(env, {
            object_type: 'athlete',
            object_id: 1,
            aspect_type: 'update',
            owner_id: 1,
            subscription_id: 1,
            event_time: 0,
            updates: { authorized: 'false' },
        });
        expect(scalar(sqlite, 'SELECT COUNT(*) AS n FROM athletes WHERE id = 1')).toBe(0);
        expect(scalar(sqlite, 'SELECT COUNT(*) AS n FROM activities WHERE athlete_id = 1')).toBe(0);
        expect(calls).toHaveLength(0);
    });
});

describe('webhook ingestion and sport_type filtering', () => {
    const event = (id: number, aspect: 'create' | 'update' | 'delete' = 'create') => ({
        object_type: 'activity' as const,
        object_id: id,
        aspect_type: aspect,
        owner_id: 1,
        subscription_id: 1,
        event_time: 0,
    });

    it.each([
        ['Run', 1],
        ['TrailRun', 1],
        ['VirtualRun', 1],
        ['Ride', 0], // the legacy `type` says Run; sport_type wins
        ['Walk', 0],
    ])('sport_type %s stores %i row(s)', async (sportType, stored) => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        stubStrava({ 'GET /activities/55': () => reply(stravaActivity(55, sportType)) });
        await handleWebhookEvent(env, event(55));
        expect(count(sqlite, 'activities')).toBe(stored);
    });

    it('stores only the fields the awards need', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        stubStrava({
            'GET /activities/55': () =>
                reply(
                    stravaActivity(55, 'Run', {
                        name: 'Secret route name',
                        map: { summary_polyline: 'abc' },
                        start_latlng: [51, 0],
                        average_heartrate: 150,
                        best_efforts: [{ name: '5K', distance: 5000, elapsed_time: 1200 }],
                    }),
                ),
        });
        await handleWebhookEvent(env, event(55));
        const row = sqlite.prepare('SELECT * FROM activities').get() as Record<string, unknown>;
        expect(Object.keys(row).sort()).toEqual(
            ['athlete_id', 'best_5k_s', 'detail_fetched_at', 'distance_m', 'elevation_gain_m', 'flagged', 'id', 'manual', 'moving_time_s', 'sport_type', 'start_date_local', 'trainer', 'updated_at'].sort(),
        );
        expect(row.best_5k_s).toBe(1200);
        expect(JSON.stringify(row)).not.toMatch(/Secret|polyline|heartrate/);
    });

    it('removes an activity on a delete event, and one that has become private', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        stubStrava({ 'GET /activities/55': () => reply(stravaActivity(55, 'Run')) });
        await handleWebhookEvent(env, event(55));
        expect(count(sqlite, 'activities')).toBe(1);

        stubStrava({ 'GET /activities/55': () => reply(stravaActivity(55, 'Run', { private: true })) });
        await handleWebhookEvent(env, event(55, 'update'));
        expect(count(sqlite, 'activities')).toBe(0);

        stubStrava({ 'GET /activities/56': () => reply(stravaActivity(56, 'Run')) });
        await handleWebhookEvent(env, event(56));
        await handleWebhookEvent(env, event(56, 'delete'));
        expect(count(sqlite, 'activities')).toBe(0);
    });
});
