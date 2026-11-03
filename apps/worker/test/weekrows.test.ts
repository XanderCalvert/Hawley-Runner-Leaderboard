import { describe, expect, it } from 'vitest';
import { clubWeekRows } from '../src/routes/api.ts';
import { updateMember } from '../src/routes/admin.ts';
import { CLUB, makeEnv, seedAthlete } from './helpers.ts';

type Env = ReturnType<typeof makeEnv>['env'];

function addRun(sqlite: ReturnType<typeof makeEnv>['sqlite'], id: number, athleteId: number, date: string, km: number, sport = 'Run') {
    sqlite
        .prepare('INSERT INTO activities (id, athlete_id, sport_type, start_date_local, distance_m, moving_time_s, elevation_gain_m) VALUES (?, ?, ?, ?, ?, ?, 20)')
        .run(id, athleteId, sport, `${date}T07:30:00`, km * 1000, km * 330);
}

const put = (env: Env, athleteId: number, body: unknown) =>
    updateMember(new Request('https://w.test/admin', { method: 'PUT', body: JSON.stringify(body) }), env, CLUB.slug, athleteId);

const weekRows = async (env: Env, week = '2026-10-19') =>
    (await clubWeekRows(new Request(`https://w.test/api/clubs/${CLUB.slug}/week-rows?week=${week}`), env, CLUB.slug)).json() as Promise<{
        rows: Array<{ name: string; distanceM: number }>;
        history: Array<{ weekStart: string; rows: unknown[] }>;
        previousRows: unknown[];
        groups: Array<{ id: string; members: string[] }>;
    }>;

async function seed() {
    const ctx = makeEnv();
    await seedAthlete(ctx.repo, 1);
    await seedAthlete(ctx.repo, 2, { firstname: 'Tom', lastname: 'Barker' });
    addRun(ctx.sqlite, 1, 1, '2026-10-20', 8);
    addRun(ctx.sqlite, 2, 2, '2026-10-21', 5);
    addRun(ctx.sqlite, 3, 1, '2026-10-13', 6); // the week before
    return ctx;
}

describe('GET week-rows', () => {
    it('returns First L. rows for the week, four weeks of history and no IDs', async () => {
        const { env } = await seed();
        const body = await weekRows(env);
        expect(body.rows.map((r) => r.name).sort()).toEqual(['Sarah K.', 'Tom B.']);
        expect(body.history.map((h) => h.weekStart)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
        expect(body.previousRows).toHaveLength(1);
        expect(JSON.stringify(body)).not.toMatch(/athlete|"id":\d|Kent|Barker|access|refresh/);
    });

    it('leaves out hidden runners, in this week and in the history', async () => {
        const { env, repo } = await seed();
        await repo.setHidden(CLUB.slug, 1, true);
        const body = await weekRows(env);
        expect(body.rows.map((r) => r.name)).toEqual(['Tom B.']);
        expect(body.previousRows).toEqual([]);
    });

    it('rejects a bad week', async () => {
        const { env } = await seed();
        const response = await clubWeekRows(new Request('https://w.test/x?week=nope'), env, CLUB.slug);
        expect(response.status).toBe(400);
    });
});

describe('admin groups', () => {
    it('assigns and clears a group, which the endpoint then lists by name', async () => {
        const { env } = await seed();
        expect((await put(env, 2, { group: 'women' })).status).toBe(200);
        expect((await weekRows(env)).groups).toEqual([expect.objectContaining({ id: 'women', members: ['Tom B.'] })]);

        expect((await put(env, 2, { group: null })).status).toBe(200);
        expect((await weekRows(env)).groups[0]?.members).toEqual([]);
    });

    it('rejects an unknown group, an empty body and an unknown member', async () => {
        const { env } = await seed();
        expect((await put(env, 2, { group: 'robots' })).status).toBe(400);
        expect((await put(env, 2, {})).status).toBe(400);
        expect((await put(env, 999, { group: 'women' })).status).toBe(404);
    });

    it('keeps hidden runners out of the group list', async () => {
        const { env } = await seed();
        await put(env, 2, { group: 'women' });
        await put(env, 2, { status: 'hidden' });
        expect((await weekRows(env)).groups[0]?.members).toEqual([]);
    });

    it('forgets the group on disconnect', async () => {
        const { env, repo, sqlite } = await seed();
        await put(env, 2, { group: 'women' });
        await repo.deleteAthlete(2);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM memberships WHERE group_id IS NOT NULL').get()).toEqual({ n: 0 });
    });
});
