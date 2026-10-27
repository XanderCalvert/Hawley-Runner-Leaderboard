import { afterEach, describe, expect, it, vi } from 'vitest';
import { signState } from '../src/crypto.ts';
import { authCallback } from '../src/routes/auth.ts';
import { StravaClient, isAthleteLimit } from '../src/strava.ts';
import { syncAthlete } from '../src/sync.ts';
import { CLUB, count, makeEnv, reply, seedAthlete, stubStrava, tokenResponse } from './helpers.ts';

afterEach(() => vi.unstubAllGlobals());

const options = { afterEpoch: 0, detailSince: '2026-01-01', detailLimit: 0, maxPages: 1 };

/** Backdates verification so the weekly membership check is due. */
function makeDue(sqlite: ReturnType<typeof makeEnv>['sqlite']) {
    sqlite.exec("UPDATE memberships SET verified_at = datetime('now', '-8 days')");
}

describe('weekly membership check', () => {
    it('keeps a runner who is still in the Strava club', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        makeDue(sqlite);
        stubStrava({
            'GET /athlete/clubs': () => reply([{ id: CLUB.stravaClubId, name: 'Hawley' }]),
            'GET /athlete/activities': () => reply([]),
        });

        await syncAthlete(env, new StravaClient(env), 1, options);

        expect(count(sqlite, 'athletes')).toBe(1);
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM memberships WHERE verified_at > datetime('now', '-1 hour')").get()).toEqual({ n: 1 });
    });

    it('deletes a leaver and revokes their token, but only on a successful list without the club', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        makeDue(sqlite);
        const calls = stubStrava({
            'GET /athlete/clubs': () => reply([{ id: 999, name: 'Somewhere else' }]),
            'POST /oauth/revoke': () => reply(null),
        });

        await syncAthlete(env, new StravaClient(env), 1, options);

        for (const table of ['athletes', 'memberships', 'activities']) {
            expect(count(sqlite, table)).toBe(0);
        }
        const revoke = calls.find((c) => c.path === '/oauth/revoke');
        expect(revoke?.headers.get('Authorization')).toBe(`Basic ${btoa('12345:client-secret')}`);
        expect(new URLSearchParams(revoke?.body).get('token')).toBe('refresh-1');
        // No activities were pulled for someone who is no longer a member.
        expect(calls.some((c) => c.path === '/athlete/activities')).toBe(false);
    });

    it.each([
        ['a server error', () => reply({ message: 'boom' }, 500)],
        ['a rate limit', () => reply({ message: 'slow down' }, 429)],
        ['an unauthorised response', () => reply({ message: 'nope' }, 401)],
        ['a malformed body', () => reply({ not: 'a list' })],
    ])('never counts %s as leaving', async (_name, respond) => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        makeDue(sqlite);
        const calls = stubStrava({ 'GET /athlete/clubs': respond });

        await expect(syncAthlete(env, new StravaClient(env), 1, options)).rejects.toThrow();

        expect(count(sqlite, 'athletes')).toBe(1);
        expect(count(sqlite, 'memberships')).toBe(1);
        expect(calls.some((c) => c.path === '/oauth/revoke')).toBe(false);
    });

    it('does not call /athlete/clubs when the check is not yet due', async () => {
        const { env, repo } = makeEnv();
        await seedAthlete(repo);
        const calls = stubStrava({ 'GET /athlete/activities': () => reply([]) });
        await syncAthlete(env, new StravaClient(env), 1, options);
        expect(calls.some((c) => c.path === '/athlete/clubs')).toBe(false);
    });
});

describe('connect callback', () => {
    async function callback(env: ReturnType<typeof makeEnv>['env'], scope = 'read,activity:read') {
        const state = await signState(env.APP_SECRET, { club: CLUB.slug, intent: 'join', iat: Date.now() });
        const url = `https://worker.test/auth/callback?code=abc&scope=${scope}&state=${encodeURIComponent(state)}`;
        const pending: Promise<unknown>[] = [];
        const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as unknown as ExecutionContext;
        const response = await authCallback(new Request(url), env, ctx);
        await Promise.all(pending);
        return new URL(response.headers.get('Location') ?? '').searchParams.get('status');
    }

    const inClub = () => reply([{ id: CLUB.stravaClubId, name: 'Hawley' }]);
    const elsewhere = () => reply([{ id: 999, name: 'Another club' }]);

    it('stores a runner who is in the Strava club', async () => {
        const { env, sqlite } = makeEnv();
        stubStrava({
            'POST /oauth/token': () => reply(tokenResponse(1)),
            'GET /athlete/clubs': inClub,
            'GET /athlete/activities': () => reply([]),
        });
        expect(await callback(env)).toBe('connected');
        expect(count(sqlite, 'athletes')).toBe(1);
        expect(count(sqlite, 'memberships')).toBe(1);
    });

    it('stores nothing for a non-member, and revokes the token it was just given', async () => {
        const { env, sqlite } = makeEnv();
        const calls = stubStrava({
            'POST /oauth/token': () => reply(tokenResponse(1)),
            'GET /athlete/clubs': elsewhere,
            'POST /oauth/revoke': () => reply(null),
        });
        expect(await callback(env)).toBe('not-member');
        expect(count(sqlite, 'athletes')).toBe(0);
        expect(count(sqlite, 'memberships')).toBe(0);
        expect(new URLSearchParams(calls.find((c) => c.path === '/oauth/revoke')?.body).get('token')).toBe('access-1');
    });

    it('stores nothing if the club check itself fails', async () => {
        const { env, sqlite } = makeEnv();
        stubStrava({
            'POST /oauth/token': () => reply(tokenResponse(1)),
            'GET /athlete/clubs': () => reply({}, 500),
            'POST /oauth/revoke': () => reply(null),
        });
        expect(await callback(env)).toBe('error');
        expect(count(sqlite, 'athletes')).toBe(0);
    });

    it('does not revoke a runner who is already connected', async () => {
        const { env, repo } = makeEnv();
        await seedAthlete(repo);
        const calls = stubStrava({
            'POST /oauth/token': () => reply(tokenResponse(2)),
            'GET /athlete/clubs': elsewhere,
            'POST /oauth/revoke': () => reply(null),
        });
        expect(await callback(env)).toBe('not-member');
        expect(calls.some((c) => c.path === '/oauth/revoke')).toBe(false);
    });

    it('needs activity:read back from the consent screen', async () => {
        const { env, sqlite } = makeEnv();
        stubStrava({ 'POST /oauth/token': () => reply(tokenResponse(1)), 'POST /oauth/revoke': () => reply(null) });
        expect(await callback(env, 'read')).toBe('missing-scope');
        expect(count(sqlite, 'athletes')).toBe(0);
    });

    it('shows the "leaderboard is full" outcome at Strava\'s athlete limit', async () => {
        const { env, sqlite } = makeEnv();
        stubStrava({ 'POST /oauth/token': () => reply({ message: 'Limit of connected athletes exceeded' }, 403) });
        expect(await callback(env)).toBe('full');
        expect(count(sqlite, 'athletes')).toBe(0);
    });

    it('recognises the athlete-limit response, and nothing else', () => {
        expect(isAthleteLimit(403, 'Limit of connected athletes exceeded')).toBe(true);
        expect(isAthleteLimit(500, 'limit')).toBe(false);
        expect(isAthleteLimit(401, 'Authorization Error')).toBe(false);
    });

    it('requests only read,activity:read', () => {
        const { env } = makeEnv();
        const url = new URL(new StravaClient(env).authoriseUrl('https://worker.test/auth/callback', 's'));
        expect(url.searchParams.get('scope')).toBe('read,activity:read');
    });
});
