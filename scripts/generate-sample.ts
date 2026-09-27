/**
 * Writes a sample weekly summary for the static site, so the infographic can be designed
 * and tested without Strava. Usage: npm run sample -- [club-slug] [week-start YYYY-MM-DD]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWeeklySummary, displayName, lastCompletedWeekStart, weekEndOf, weekStartOf } from '../packages/core/src/index.ts';
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
    best10kS: a.best_efforts.find((e) => e.distance === 10000)?.elapsed_time ?? null,
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
