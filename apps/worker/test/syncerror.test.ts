import { afterEach, expect, it, vi } from 'vitest';
import { resyncAthlete } from '../src/routes/admin.ts';
import { CLUB, makeEnv, reply, seedAthlete, stubStrava } from './helpers.ts';

afterEach(() => vi.unstubAllGlobals());

it('records why a resync failed, shows it to the admin, and clears it after a good sync', async () => {
    const { env, repo } = makeEnv();
    await seedAthlete(repo);

    stubStrava({ 'GET /athlete/activities': () => reply({ message: 'boom' }, 500) });
    const failed = (await (await resyncAthlete(env, 1)).json()) as { ok: boolean; error: string };
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('500');
    expect((await repo.listMembers(CLUB.slug, '2026-01-01'))[0]?.syncError).toContain('500');

    stubStrava({ 'GET /athlete/activities': () => reply([]), 'GET /athletes/1/stats': () => reply({}) });
    expect(await (await resyncAthlete(env, 1)).json()).toEqual({ ok: true, error: null });
    expect((await repo.listMembers(CLUB.slug, '2026-01-01'))[0]?.syncError).toBeNull();
});

it('tells the admin a rate limit is the reason, and a pending runner is not syncable', async () => {
    const { env, repo, sqlite } = makeEnv();
    await seedAthlete(repo);
    stubStrava({ 'GET /athlete/activities': () => reply({}, 429) });
    const limited = (await (await resyncAthlete(env, 1)).json()) as { ok: boolean; error: string };
    expect(limited.error).toMatch(/rate limit/i);

    // Now paused: the next click says so without calling Strava.
    const calls = stubStrava({});
    expect(((await (await resyncAthlete(env, 1)).json()) as { error: string }).error).toMatch(/paused/i);
    expect(calls).toHaveLength(0);

    sqlite.exec("UPDATE memberships SET approval = 'pending'");
    expect((await resyncAthlete(env, 1)).status).toBe(404);
});
