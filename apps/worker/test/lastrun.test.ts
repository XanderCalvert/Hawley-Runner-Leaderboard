import { expect, it } from 'vitest';
import { CLUB, makeEnv, seedAthlete } from './helpers.ts';

it('lists each runner with the date of their most recent stored run', async () => {
    const { repo, sqlite } = makeEnv();
    await seedAthlete(repo);
    const insert = sqlite.prepare("INSERT INTO activities (id, athlete_id, sport_type, start_date_local, distance_m, moving_time_s) VALUES (?, 1, 'Run', ?, 5000, 1500)");
    insert.run(1, '2026-10-20T07:30:00');
    insert.run(2, '2026-11-02T06:00:00');

    const [member] = await repo.listMembers(CLUB.slug, '2026-01-01');
    expect(member?.lastRun).toBe('2026-11-02T06:00:00');
});

it('gives null for a runner with no stored runs', async () => {
    const { repo } = makeEnv();
    await seedAthlete(repo);
    expect((await repo.listMembers(CLUB.slug, '2026-01-01'))[0]?.lastRun).toBeNull();
});
