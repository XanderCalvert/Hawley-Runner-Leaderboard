import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signState } from '../src/crypto.ts';
import { approveMember, checkClub, removeMember } from '../src/routes/admin.ts';
import { authCallback } from '../src/routes/auth.ts';
import { clubWeekRows } from '../src/routes/api.ts';
import { StravaClient } from '../src/strava.ts';
import { handleWebhookEvent, runScheduledSync, syncAthlete } from '../src/sync.ts';
import { CLUB, count, makeEnv, reply, seedAthlete, stravaActivity, stubStrava, tokenResponse } from './helpers.ts';

beforeEach(() => {
    CLUB.approveNonMembers = true;
});
afterEach(() => vi.unstubAllGlobals());

const outsider = {
    'POST /oauth/token': () => reply(tokenResponse(1)),
    'GET /athlete/clubs': () => reply([{ id: 999, name: 'Another club' }]),
    'GET /athlete/activities': () => reply([]),
    'POST /oauth/revoke': () => reply(null),
    'POST /emails': () => reply({ id: 'e1' }),
};
const options = { afterEpoch: 0, detailSince: '2026-01-01', detailLimit: 0, maxPages: 1 };
const mail = { RESEND_API_KEY: 'k', NOTIFY_EMAIL_TO: 'owner@example.com' };

async function connect(env: ReturnType<typeof makeEnv>['env']) {
    const state = await signState(env.APP_SECRET, { club: CLUB.slug, intent: 'join', iat: Date.now() });
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as unknown as ExecutionContext;
    const response = await authCallback(new Request(`https://w.test/auth/callback?code=c&scope=read,activity:read&state=${encodeURIComponent(state)}`), env, ctx);
    await Promise.all(pending);
    return new URL(response.headers.get('Location') ?? '').searchParams.get('status');
}

const ctx = () => {
    const pending: Promise<unknown>[] = [];
    return { ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as unknown as ExecutionContext, settle: () => Promise.all(pending) };
};

async function pendingRunner(overrides = {}) {
    const made = makeEnv(overrides);
    stubStrava(outsider);
    await connect(made.env);
    return made;
}

describe('a non-member asks to join', () => {
    it('is held as pending with no runs fetched, and the owner is emailed once', async () => {
        const made = makeEnv(mail);
        const calls = stubStrava(outsider);
        expect(await connect(made.env)).toBe('pending');
        expect(made.sqlite.prepare('SELECT approval FROM memberships').get()).toEqual({ approval: 'pending' });
        expect(count(made.sqlite, 'athletes')).toBe(1);
        expect(calls.some((c) => c.path === '/athlete/activities')).toBe(false);
        expect(calls.some((c) => c.path === '/oauth/revoke')).toBe(false);
        const email = JSON.parse(calls.find((c) => c.path === '/emails')?.body ?? '{}');
        expect(email.subject).toBe('Approval needed: Sarah K. wants to join Hawley Runners');

        calls.length = 0;
        await connect(made.env); // asking again does not email again
        expect(calls.some((c) => c.path === '/emails')).toBe(false);
    });

    it('is turned away as before when the club does not take approvals', async () => {
        CLUB.approveNonMembers = false;
        const made = makeEnv();
        stubStrava(outsider);
        expect(await connect(made.env)).toBe('not-member');
        expect(count(made.sqlite, 'athletes')).toBe(0);
    });

    it('never appears anywhere or gets any data fetched while pending', async () => {
        const { env, repo, sqlite } = await pendingRunner();
        sqlite.prepare("INSERT INTO activities (id, athlete_id, sport_type, start_date_local, distance_m, moving_time_s) VALUES (1, 1, 'Run', '2026-10-20T07:30:00', 5000, 1500)").run();

        const rows = await (await clubWeekRows(new Request('https://w.test/x?week=2026-10-19'), env, CLUB.slug)).json();
        expect(JSON.stringify(rows)).not.toContain('Sarah');
        expect((rows as { rows: unknown[] }).rows).toEqual([]);
        expect(await repo.activeAthletes(CLUB.slug)).toEqual([]);
        expect(await repo.memberCount(CLUB.slug)).toBe(0);

        const calls = stubStrava({ 'GET /athlete/activities': () => reply([stravaActivity(5, 'Run')]), 'GET /activities/5': () => reply(stravaActivity(5, 'Run')) });
        await syncAthlete(env, new StravaClient(env), 1, options);
        await handleWebhookEvent(env, { object_type: 'activity', object_id: 5, aspect_type: 'create', owner_id: 1, subscription_id: 1, event_time: 0 });
        await runScheduledSync(env);
        expect(calls).toHaveLength(0);
    });
});

describe('approving and rejecting', () => {
    it('approve makes them a guest, loads their runs, and the weekly club check leaves them alone', async () => {
        const { env, sqlite, repo } = await pendingRunner();
        const { ctx: c, settle } = ctx();
        const calls = stubStrava({ 'GET /athlete/activities': () => reply([stravaActivity(5, 'Run')]), 'GET /athletes/1/stats': () => reply({}), 'GET /athlete/clubs': () => reply([]) });
        expect((await approveMember(env, c, CLUB.slug, 1)).status).toBe(200);
        await settle();

        expect(sqlite.prepare('SELECT approval FROM memberships').get()).toEqual({ approval: 'guest' });
        expect(count(sqlite, 'activities')).toBe(1);
        expect((await repo.activeAthletes(CLUB.slug)).map((a) => a.displayName)).toEqual(['Sarah K.']);

        // A week later: the club check must not touch a guest, even though they are not in the Strava club.
        sqlite.exec("UPDATE memberships SET verified_at = datetime('now', '-30 days')");
        calls.length = 0;
        await syncAthlete(env, new StravaClient(env), 1, options);
        expect(calls.some((x) => x.path === '/athlete/clubs')).toBe(false);
        expect(count(sqlite, 'athletes')).toBe(1);
    });

    it('can only approve a pending request', async () => {
        const { env, repo } = makeEnv();
        await seedAthlete(repo); // an ordinary verified member
        expect((await approveMember(env, ctx().ctx, CLUB.slug, 1)).status).toBe(404);
        expect((await approveMember(env, ctx().ctx, CLUB.slug, 999)).status).toBe(404);
    });

    it('remove deletes everything and revokes their access', async () => {
        const { env, sqlite } = await pendingRunner();
        const calls = stubStrava({ 'POST /oauth/revoke': () => reply(null) });
        expect((await removeMember(env, CLUB.slug, 1)).status).toBe(200);
        for (const table of ['athletes', 'memberships', 'activities']) {
            expect(count(sqlite, table)).toBe(0);
        }
        expect(calls.some((c) => c.path === '/oauth/revoke')).toBe(true);
        expect((await removeMember(env, CLUB.slug, 1)).status).toBe(404);
    });

    it('a pending request nobody approves is deleted after two weeks', async () => {
        const { env, sqlite } = await pendingRunner();
        const calls = stubStrava({ 'POST /oauth/revoke': () => reply(null), 'GET /athlete/activities': () => reply([]) });
        await runScheduledSync(env);
        expect(count(sqlite, 'athletes')).toBe(1); // too soon

        sqlite.exec("UPDATE memberships SET joined_at = datetime('now', '-15 days')");
        await runScheduledSync(env);
        expect(count(sqlite, 'athletes')).toBe(0);
        expect(calls.some((c) => c.path === '/oauth/revoke')).toBe(true);
    });

    it('a pending person who turns out to be in the club is upgraded to a member', async () => {
        const { env, sqlite } = await pendingRunner();
        stubStrava({ ...outsider, 'GET /athlete/clubs': () => reply([{ id: CLUB.stravaClubId, name: 'Hawley' }]) });
        expect(await connect(env)).toBe('connected');
        expect(sqlite.prepare('SELECT approval FROM memberships').get()).toEqual({ approval: 'member' });
    });
});

describe('checking a runner against the Strava club', () => {
    it('says whether they are in the group, and changes nothing', async () => {
        const { env, repo, sqlite } = makeEnv();
        await seedAthlete(repo);
        stubStrava({ 'GET /athlete/clubs': () => reply([{ id: 999, name: 'elsewhere' }]) });
        const body = (await (await checkClub(env, CLUB.slug, 1)).json()) as { inClub: boolean };
        expect(body.inClub).toBe(false);
        expect(count(sqlite, 'athletes')).toBe(1);

        stubStrava({ 'GET /athlete/clubs': () => reply([{ id: CLUB.stravaClubId, name: 'Hawley' }]) });
        expect(((await (await checkClub(env, CLUB.slug, 1)).json()) as { inClub: boolean }).inClub).toBe(true);
    });

    it('reports a Strava failure instead of guessing', async () => {
        const { env, repo } = makeEnv();
        await seedAthlete(repo);
        stubStrava({ 'GET /athlete/clubs': () => reply({}, 500) });
        expect((await checkClub(env, CLUB.slug, 1)).status).toBe(502);
    });
});

describe('group picked from the sex Strava reports on connecting', () => {
    const as = (sex?: string) => ({ ...outsider, 'GET /athlete/clubs': () => reply([{ id: CLUB.stravaClubId, name: 'Hawley' }]), 'POST /oauth/token': () => reply({ ...tokenResponse(1), athlete: { id: 1, firstname: 'Sarah', lastname: 'Kent', sex } }) });
    const group = (sqlite: ReturnType<typeof makeEnv>['sqlite']) => sqlite.prepare('SELECT group_id FROM memberships').get();

    it('puts women in the Women group and leaves everyone else ungrouped', async () => {
        const f = makeEnv();
        stubStrava(as('F'));
        await connect(f.env);
        expect(group(f.sqlite)).toEqual({ group_id: 'women' });

        const m = makeEnv();
        stubStrava(as('M'));
        await connect(m.env);
        expect(group(m.sqlite)).toEqual({ group_id: null });

        const none = makeEnv();
        stubStrava(as(undefined));
        await connect(none.env);
        expect(group(none.sqlite)).toEqual({ group_id: null });
    });

    it('keeps a group an admin already set when they reconnect, and never stores the sex', async () => {
        const { env, sqlite } = makeEnv();
        stubStrava(as('M'));
        await connect(env);
        sqlite.exec("UPDATE memberships SET group_id = 'women'"); // admin put them in Women by hand
        await connect(env); // Strava still says M
        expect(group(sqlite)).toEqual({ group_id: 'women' });
        expect(JSON.stringify(sqlite.prepare('SELECT * FROM athletes').all())).not.toMatch(/sex|"M"/i);
    });
});
