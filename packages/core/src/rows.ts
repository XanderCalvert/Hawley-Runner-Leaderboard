import { addDays, localDateOf } from './dates.ts';
import { isEligible, trustedEffort } from './summary.ts';
import type { ActivityRecord, AthleteRecord, ClubConfig } from './types.ts';

/** One runner's totals for one week: what the recap cards are built from. */
export interface WeekRow {
    /** "First L." */
    name: string;
    distanceM: number;
    runs: number;
    longestM: number;
    /** Average pace in seconds per km, from outdoor runs only (see below). */
    paceSPerKm: number | null;
    /** Fastest 5K effort in seconds from a single run (Strava's best efforts, GPS runs only), or null. */
    best5kS: number | null;
    elevationM: number;
    movingTimeS: number;
}

export interface WeekRowsInput {
    club: ClubConfig;
    /** Opted-in, club-member, not-hidden runners only. Anyone else's activities are ignored. */
    athletes: AthleteRecord[];
    activities: ActivityRecord[];
    weekStart: string;
}

/**
 * Totals follow the club's rules (e.g. Hawley counts virtual runs). Longest run and pace follow the sport types
 * of the club's "longestRun" and "best5k" awards, so a treadmill or Zwift run can't win them.
 */
export function buildWeekRows({ club, athletes, activities, weekStart }: WeekRowsInput): WeekRow[] {
    const weekEnd = addDays(weekStart, 6);
    const names = new Map(athletes.map((a) => [a.id, a.displayName]));
    const awardTypes = (metric: string) => club.awards.find((a) => a.metric === metric)?.sportTypes;
    const longestTypes = awardTypes('longestRun');
    const paceTypes = awardTypes('best5k');

    const byAthlete = new Map<number, ActivityRecord[]>();
    for (const activity of activities) {
        const date = localDateOf(activity.startDateLocal);
        if (!names.has(activity.athleteId) || date < weekStart || date > weekEnd || !isEligible(activity, club.rules)) {
            continue;
        }
        byAthlete.set(activity.athleteId, [...(byAthlete.get(activity.athleteId) ?? []), activity]);
    }

    const sum = (runs: ActivityRecord[], pick: (r: ActivityRecord) => number) => runs.reduce((total, r) => total + pick(r), 0);
    const only = (runs: ActivityRecord[], types?: string[]) => (types ? runs.filter((r) => types.includes(r.sportType)) : runs);

    return [...byAthlete].map(([athleteId, runs]) => {
        const paceRuns = only(runs, paceTypes);
        const paceDistanceKm = sum(paceRuns, (r) => r.distanceM) / 1000;
        return {
            name: names.get(athleteId) as string,
            distanceM: sum(runs, (r) => r.distanceM),
            runs: runs.length,
            longestM: Math.max(0, ...only(runs, longestTypes).map((r) => r.distanceM)),
            paceSPerKm: paceDistanceKm > 0 ? sum(paceRuns, (r) => r.movingTimeS) / paceDistanceKm : null,
            best5kS: paceRuns.reduce<number | null>((best, r) => {
                const effort = trustedEffort(r, r.best5kS, 5, club.rules);
                return effort !== null && (best === null || effort < best) ? effort : best;
            }, null),
            elevationM: sum(runs, (r) => r.elevationGainM),
            movingTimeS: sum(runs, (r) => r.movingTimeS),
        };
    });
}
