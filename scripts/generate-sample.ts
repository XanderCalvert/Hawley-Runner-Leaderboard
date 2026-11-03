/**
 * Writes a sample weekly summary for the static site, so the infographic can be designed
 * and tested without Strava. Usage: npm run sample -- [club-slug] [week-start YYYY-MM-DD]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, buildAchievements, buildWeekRows, buildWeeklySummary, displayName, lastCompletedWeekStart, weekEndOf, weekStartOf } from '../packages/core/src/index.ts';
import type { ActivityRecord } from '../packages/core/src/index.ts';
import { getClub } from '../config/clubs/index.ts';
import { fakeActivities, fakeAthletes } from './lib/fake-runners.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2] ?? 'hawley-runners';
const club = getClub(slug);
if (!club) {
    console.error(`Unknown club: ${slug}`);
    process.exit(1);
}

const weekStart = process.argv[3] ? weekStartOf(process.argv[3]) : lastCompletedWeekStart(club.timezone);
const year = weekEndOf(weekStart).slice(0, 4);

const athletes = fakeAthletes(30);
const activities: ActivityRecord[] = fakeActivities(athletes, `${Number(year) - 1}-12-20`, weekEndOf(weekStart)).map((a) => ({
    id: a.id,
    athleteId: a.athlete.id,
    sportType: a.sport_type,
    startDateLocal: a.start_date_local.replace(/Z$/, ''),
    distanceM: a.distance,
    movingTimeS: a.moving_time,
    elevationGainM: a.total_elevation_gain,
    manual: a.manual,
    trainer: a.trainer,
    flagged: a.flagged,
    best5kS: a.best_efforts.find((e) => e.distance === 5000)?.elapsed_time ?? null,
    // Fake: a few runs are flagged as PBs so the card has something to show.
    prEfforts: a.id % 11 === 0 ? (a.id % 22 === 0 ? ['5K', '10K'] : ['5K']) : [],
}));

const summary = buildWeeklySummary({
    club,
    athletes: athletes.map((a) => ({ id: a.id, displayName: displayName(a.firstname, a.lastname) })),
    activities,
    weekStart,
});

const out = resolve(root, 'apps/web/sample', `${slug}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(summary, null, 4) + '\n');
console.log(`Wrote ${out} for week ${summary.week.label}`);

// The per-runner rows the recap page builds both cards from (same shape as GET /api/clubs/:slug/week-rows).
const people = athletes.map((a) => ({ id: a.id, displayName: displayName(a.firstname, a.lastname) }));
const rowsFor = (start: string) => buildWeekRows({ club, athletes: people, activities, weekStart: start });
const history = [4, 3, 2, 1].map((n) => ({ weekStart: addDays(weekStart, -7 * n), rows: rowsFor(addDays(weekStart, -7 * n)) }));
const rowsOut = resolve(root, 'apps/web/sample', `${slug}-rows.json`);
writeFileSync(
    rowsOut,
    JSON.stringify(
        {
            weekStart,
            rows: rowsFor(weekStart),
            previousRows: history.at(-1)?.rows ?? [],
            history,
            // Fake: every third fake runner is "women", just to show the two panels.
            groups: (club.groups ?? []).map((g) => ({ ...g, members: people.filter((_, i) => i % 3 === 0).map((p) => p.displayName) })),
        },
        null,
        4,
    ) + '\n',
);
// Fake lifetime baselines, nudged so a few runners cross a milestone this week.
const lifetimeBaseM = new Map(
    people.map((p, i) => {
        const before = activities.filter((a) => a.athleteId === p.id && a.startDateLocal.slice(0, 10) < weekStart).reduce((s, a) => s + a.distanceM, 0);
        return [p.id, i % 6 === 0 ? 5_000_000 - before - 15_000 : 1_200_000 + i * 90_000];
    }),
);
const achievements = buildAchievements({ club, athletes: people, activities, lifetimeBaseM, weekStart });
const stored = JSON.parse(readFileSync(rowsOut, 'utf-8'));
writeFileSync(rowsOut, JSON.stringify({ ...stored, achievements }, null, 4) + '\n');
console.log(`Wrote ${rowsOut}`);
