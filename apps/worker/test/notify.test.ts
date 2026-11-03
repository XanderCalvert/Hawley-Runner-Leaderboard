import { afterEach, describe, expect, it, vi } from 'vitest';
import { signState } from '../src/crypto.ts';
import { notifyOwner } from '../src/notify.ts';
import { authCallback } from '../src/routes/auth.ts';
import { CLUB, count, makeEnv, reply, seedAthlete, stubStrava, tokenResponse } from './helpers.ts';

afterEach(() => vi.unstubAllGlobals());

const mail = { RESEND_API_KEY: 'resend-key', NOTIFY_EMAIL_TO: 'owner@example.com' };

async function connect(env: ReturnType<typeof makeEnv>['env']) {
    const state = await signState(env.APP_SECRET, { club: CLUB.slug, intent: 'join', iat: Date.now() });
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as unknown as ExecutionContext;
    await authCallback(new Request(`https://worker.test/auth/callback?code=abc&scope=read,activity:read&state=${encodeURIComponent(state)}`), env, ctx);
    await Promise.all(pending);
}

const strava = {
    'POST /oauth/token': () => reply(tokenResponse(1)),
    'GET /athlete/clubs': () => reply([{ id: CLUB.stravaClubId, name: 'Hawley' }]),
    'GET /athlete/activities': () => reply([]),
    'POST /emails': () => reply({ id: 'e1' }),
};

describe('owner notification email', () => {
    it('does nothing unless both secrets are set', async () => {
        const calls = stubStrava({});
        await notifyOwner(makeEnv().env, 's', 't');
        await notifyOwner(makeEnv({ RESEND_API_KEY: 'k' }).env, 's', 't');
        expect(calls).toHaveLength(0);
    });

    it('emails "First L." and the connected count when a new runner joins', async () => {
        const { env } = makeEnv(mail);
        const calls = stubStrava(strava);
        await connect(env);
        const email = calls.find((c) => c.path === '/emails');
        expect(email?.headers.get('Authorization')).toBe('Bearer resend-key');
        const body = JSON.parse(email?.body ?? '{}');
        expect(body.to).toEqual(['owner@example.com']);
        expect(body.subject).toBe('Sarah K. connected to Hawley Runners');
        expect(body.text).toContain('1 connected now');
        // First name and initial only: no full surname, Strava ID or token.
        expect(JSON.stringify(body)).not.toMatch(/Kent|access-1|refresh-1/);
    });

    it('does not email again when an existing runner reconnects', async () => {
        const { env, repo } = makeEnv(mail);
        await seedAthlete(repo);
        const calls = stubStrava(strava);
        await connect(env);
        expect(calls.some((c) => c.path === '/emails')).toBe(false);
    });

    it('still connects the runner if the email service fails', async () => {
        const { env, sqlite } = makeEnv(mail);
        stubStrava({ ...strava, 'POST /emails': () => reply({ message: 'nope' }, 500) });
        await connect(env);
        expect(count(sqlite, 'athletes')).toBe(1);
    });

    it('tells the owner when the athlete limit is hit, without naming anyone', async () => {
        const { env } = makeEnv(mail);
        const calls = stubStrava({ ...strava, 'POST /oauth/token': () => reply({ message: 'Limit of connected athletes exceeded' }, 403) });
        await connect(env);
        const body = JSON.parse(calls.find((c) => c.path === '/emails')?.body ?? '{}');
        expect(body.subject).toBe('Strava athlete limit reached');
    });
});
