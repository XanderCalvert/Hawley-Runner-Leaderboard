import { afterEach, describe, expect, it, vi } from 'vitest';
import { StravaClient, nextWindowReset, parseRateLimitPair } from '../src/strava.ts';
import { isBackingOff, runScheduledSync } from '../src/sync.ts';
import { makeEnv, reply, seedAthlete, stubStrava } from './helpers.ts';

afterEach(() => vi.unstubAllGlobals());

const usage = (value: string) => ({ 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': value });

describe('rate-limit headers', () => {
    it('parses the "15-minute,daily" pairs', () => {
        expect(parseRateLimitPair('100,1000')).toEqual([100, 1000]);
        expect(parseRateLimitPair(null)).toBeNull();
        expect(parseRateLimitPair('nonsense')).toBeNull();
    });

    it('flags either window at 80% of its limit', async () => {
        const { env } = makeEnv();
        const client = new StravaClient(env);
        expect(client.nearRateLimit()).toBeNull();

        for (const [used, expected] of [['10,100', null], ['80,100', 'short'], ['10,800', 'daily'], ['90,900', 'daily']] as const) {
            stubStrava({ 'GET /athlete/clubs': () => reply([], 200, usage(used)) });
            await client.clubs('t');
            expect(client.nearRateLimit()).toBe(expected);
        }
    });

    it('works out when each window resets', () => {
        expect(nextWindowReset('short', new Date('2026-09-22T10:07:30Z')).toISOString()).toBe('2026-09-22T10:15:00.000Z');
        expect(nextWindowReset('short', new Date('2026-09-22T10:45:00Z')).toISOString()).toBe('2026-09-22T11:00:00.000Z');
        expect(nextWindowReset('daily', new Date('2026-09-22T10:07:30Z')).toISOString()).toBe('2026-09-23T00:00:00.000Z');
    });
});

describe('hourly catch-up sync', () => {
    it('stops its batch early near a limit and pauses until the window resets', async () => {
        const { env, repo } = makeEnv();
        for (const id of [1, 2, 3]) {
            await seedAthlete(repo, id);
        }
        const calls = stubStrava({ 'GET /athlete/activities': () => reply([], 200, usage('90,300')) });

        await runScheduledSync(env);

        expect(calls.filter((c) => c.path === '/athlete/activities')).toHaveLength(1);
        expect(await isBackingOff(repo)).toBe(true);
    });

    it('syncs everyone when usage is comfortable', async () => {
        const { env, repo } = makeEnv();
        for (const id of [1, 2, 3]) {
            await seedAthlete(repo, id);
        }
        const calls = stubStrava({ 'GET /athlete/activities': () => reply([], 200, usage('5,50')) });
        await runScheduledSync(env);
        expect(calls.filter((c) => c.path === '/athlete/activities')).toHaveLength(3);
        expect(await isBackingOff(repo)).toBe(false);
    });

    it('does nothing while backing off after a 429', async () => {
        const { env, repo } = makeEnv();
        await seedAthlete(repo);
        const calls = stubStrava({ 'GET /athlete/activities': () => reply({}, 429) });
        await runScheduledSync(env); // hits the 429 and backs off
        calls.length = 0;
        await runScheduledSync(env);
        expect(calls).toHaveLength(0);
    });
});
