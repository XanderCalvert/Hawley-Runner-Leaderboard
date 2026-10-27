import { afterEach, describe, expect, it, vi } from 'vitest';
import { decrypt } from '../src/crypto.ts';
import { StravaClient } from '../src/strava.ts';
import { makeEnv, reply, seedAthlete, stubStrava, tokenResponse } from './helpers.ts';

afterEach(() => vi.unstubAllGlobals());

describe('access tokens', () => {
    it('keeps tokens encrypted at rest', async () => {
        const { repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        const row = sqlite.prepare('SELECT access_token, refresh_token FROM athletes').get() as Record<string, string>;
        expect(row.access_token).not.toContain('access-1');
        expect(row.refresh_token).not.toContain('refresh-1');
    });

    it('reuses a token that is not near expiry, without calling Strava', async () => {
        const { env, repo } = makeEnv();
        await seedAthlete(repo, 1, { expiresInS: 3600 });
        const calls = stubStrava({});
        expect(await repo.accessToken(1, new StravaClient(env))).toBe('access-1');
        expect(calls).toHaveLength(0);
    });

    it('refreshes within 5 minutes of expiry and stores the rotated refresh token', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo, 1, { expiresInS: 200 });
        const calls = stubStrava({ 'POST /oauth/token': () => reply(tokenResponse(2)) });

        expect(await repo.accessToken(1, new StravaClient(env))).toBe('access-2');

        const body = JSON.parse(calls[0]?.body ?? '{}');
        expect(calls[0]?.url).toBe('https://www.strava.com/oauth/token');
        expect(body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: '12345' });

        const row = sqlite.prepare('SELECT access_token, refresh_token FROM athletes').get() as Record<string, string>;
        expect(await decrypt(env.APP_SECRET, row.refresh_token as string)).toBe('refresh-2');
        expect(await decrypt(env.APP_SECRET, row.access_token as string)).toBe('access-2');
    });

    it('uses the rotated refresh token the next time, never the old one', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo, 1, { expiresInS: 200 });
        let n = 1;
        const calls = stubStrava({ 'POST /oauth/token': () => reply(tokenResponse(++n, 100)) });

        await repo.accessToken(1, new StravaClient(env)); // refresh-1 -> refresh-2, expires in 100 s
        await repo.accessToken(1, new StravaClient(env)); // still inside the 5 minute window: refresh again

        expect(calls.map((c) => JSON.parse(c.body).refresh_token)).toEqual(['refresh-1', 'refresh-2']);
    });

    it('treats a rejected refresh token as revoked access and deletes the athlete', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo, 1, { expiresInS: 100 });
        stubStrava({ 'POST /oauth/token': () => reply({ message: 'Bad Request' }, 400) });

        expect(await repo.accessToken(1, new StravaClient(env))).toBeNull();
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM athletes').get()).toEqual({ n: 0 });
    });

    it('sends the access token in the Authorization header only', async () => {
        const { env, repo } = makeEnv();
        await seedAthlete(repo);
        const calls = stubStrava({ 'GET /athlete/clubs': () => reply([]) });
        await new StravaClient(env).clubs((await repo.accessToken(1, new StravaClient(env))) as string);
        expect(calls[0]?.headers.get('Authorization')).toBe('Bearer access-1');
        expect(calls[0]?.url).not.toContain('access-1');
        expect(calls[0]?.url).toBe('https://www.strava.com/api/v3/athlete/clubs?per_page=200');
    });

    it('honours a configured API base', async () => {
        const { env } = makeEnv({ STRAVA_API_BASE: 'https://api-v3.strava.com' });
        const calls = stubStrava({ 'GET /athlete/clubs': () => reply([]) });
        await new StravaClient(env).clubs('t');
        expect(calls[0]?.url).toBe('https://api-v3.strava.com/athlete/clubs?per_page=200');
    });
});
