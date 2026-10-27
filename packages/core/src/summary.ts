import { addDays, formatWeekLabel, localDateOf, weekEndOf } from './dates.ts';
import { formatMetric } from './format.ts';
import type {
    ActivityRecord,
    AthleteRecord,
    AwardConfig,
    AwardEntry,
    AwardMetric,
    AwardResult,
    ClubConfig,
    ClubRules,
    Milestone,
    Totals,
    WeeklySummary,
} from './types.ts';

export interface BuildSummaryInput {
    club: ClubConfig;
    /** Only athletes who are opted in, club members and not excluded. Anyone else is ignored. */
    athletes: AthleteRecord[];
    /** Activities covering at least 1 January of the week's year up to the week's end. */
    activities: ActivityRecord[];
    weekStart: string;
    generatedAt?: Date;
}

/** Lower is better for these; higher is better for everything else. */
const ASCENDING_METRICS: ReadonlySet<AwardMetric> = new Set(['best5k']);

export function isEligible(activity: ActivityRecord, rules: ClubRules): boolean {
    if (!rules.sportTypes.includes(activity.sportType)) {
        return false;
    }
    if (activity.flagged) {
        return false;
    }
    if (activity.manual && !rules.includeManual) {
        return false;
    }
    if (activity.trainer && !rules.includeTreadmill) {
        return false;
    }
    if (activity.distanceM < rules.minDistanceM || activity.movingTimeS <= 0) {
        return false;
    }
    const paceSecondsPerKm = activity.movingTimeS / (activity.distanceM / 1000);
    return paceSecondsPerKm >= rules.minPaceSecondsPerKm;
}

/** A best effort is only trusted if it came from recorded GPS data and is humanly plausible. */
function trustedEffort(activity: ActivityRecord, seconds: number | null, km: number, rules: ClubRules): number | null {
    if (seconds === null || activity.manual) {
        return null;
    }
    return seconds >= km * rules.minPaceSecondsPerKm ? seconds : null;
}

function inRange(activity: ActivityRecord, from: string, to: string): boolean {
    const date = localDateOf(activity.startDateLocal);
    return date >= from && date <= to;
}

function totalsFor(activities: ActivityRecord[]): Totals {
    const runners = new Set<number>();
    const totals: Totals = { runners: 0, runs: 0, distanceM: 0, movingTimeS: 0, elevationM: 0 };
    for (const activity of activities) {
        runners.add(activity.athleteId);
        totals.runs += 1;
        totals.distanceM += activity.distanceM;
        totals.movingTimeS += activity.movingTimeS;
        totals.elevationM += activity.elevationGainM;
    }
    totals.runners = runners.size;
    return totals;
}

function metricValue(metric: AwardMetric, runs: ActivityRecord[], rules: ClubRules): number | null {
    switch (metric) {
        case 'best5k': {
            let best: number | null = null;
            for (const run of runs) {
                const effort = trustedEffort(run, run.best5kS, 5, rules);
                if (effort !== null && (best === null || effort < best)) {
                    best = effort;
                }
            }
            return best;
        }
        case 'longestRun':
            return runs.length ? Math.max(...runs.map((r) => r.distanceM)) : null;
        case 'distanceTotal':
            return runs.reduce((sum, r) => sum + r.distanceM, 0);
        case 'elevationTotal':
            return runs.reduce((sum, r) => sum + r.elevationGainM, 0);
        case 'runCount':
            return runs.length;
        case 'movingTimeTotal':
            return runs.reduce((sum, r) => sum + r.movingTimeS, 0);
    }
}

function buildAward(
    award: AwardConfig,
    runsByAthlete: Map<number, ActivityRecord[]>,
    names: Map<number, string>,
    rules: ClubRules,
): AwardResult {
    const ascending = ASCENDING_METRICS.has(award.metric);
    const scored: Array<{ athleteId: number; value: number; distance: number }> = [];

    for (const [athleteId, allRuns] of runsByAthlete) {
        const runs = award.sportTypes ? allRuns.filter((r) => award.sportTypes?.includes(r.sportType)) : allRuns;
        const value = metricValue(award.metric, runs, rules);
        if (value === null || value <= 0) {
            continue;
        }
        const distance = runs.reduce((sum, r) => sum + r.distanceM, 0);
        scored.push({ athleteId, value, distance });
    }

    scored.sort((a, b) => {
        const byValue = ascending ? a.value - b.value : b.value - a.value;
        if (byValue !== 0) {
            return byValue;
        }
        // Tie-break: more weekly distance first, then alphabetical so output is stable.
        if (b.distance !== a.distance) {
            return b.distance - a.distance;
        }
        return (names.get(a.athleteId) ?? '').localeCompare(names.get(b.athleteId) ?? '');
    });

    const entries: AwardEntry[] = [];
    let moreTied = 0;
    let previous: number | null = null;
    let rank = 0;
    scored.forEach((row, index) => {
        if (row.value !== previous) {
            rank = index + 1;
            previous = row.value;
        }
        if (rank > award.top) {
            return;
        }
        // Everyone tied for a podium place qualifies, but only `top` rows are shown; the rest are counted.
        if (entries.length >= award.top) {
            moreTied++;
            return;
        }
        entries.push({
            rank,
            name: names.get(row.athleteId) ?? 'Runner',
            value: row.value,
            display: formatMetric(award.metric, row.value),
        });
    });

    return { id: award.id, label: award.label, metric: award.metric, entries, moreTied };
}

function buildMilestones(
    ytdBefore: Map<number, number>,
    ytdAfter: Map<number, number>,
    names: Map<number, string>,
    steps: number[],
): Milestone[] {
    const milestones: Milestone[] = [];
    for (const [athleteId, afterM] of ytdAfter) {
        const beforeKm = (ytdBefore.get(athleteId) ?? 0) / 1000;
        const afterKm = afterM / 1000;
        const crossed = steps.filter((step) => beforeKm < step && afterKm >= step);
        const highest = crossed.at(-1);
        if (highest !== undefined) {
            milestones.push({ name: names.get(athleteId) ?? 'Runner', km: highest });
        }
    }
    return milestones.sort((a, b) => b.km - a.km || a.name.localeCompare(b.name));
}

export function buildWeeklySummary(input: BuildSummaryInput): WeeklySummary {
    const { club, athletes, weekStart } = input;
    const weekEnd = weekEndOf(weekStart);
    const year = Number(weekEnd.slice(0, 4));
    const yearStart = `${year}-01-01`;
    const previousStart = addDays(weekStart, -7);
    const previousEnd = addDays(weekStart, -1);

    const names = new Map(athletes.map((a) => [a.id, a.displayName]));
    const eligible = input.activities.filter(
        (activity) => names.has(activity.athleteId) && isEligible(activity, club.rules),
    );

    const week = eligible.filter((a) => inRange(a, weekStart, weekEnd));
    const previousWeek = eligible.filter((a) => inRange(a, previousStart, previousEnd));
    const ytd = eligible.filter((a) => inRange(a, yearStart, weekEnd));

    const runsByAthlete = new Map<number, ActivityRecord[]>();
    for (const activity of week) {
        const list = runsByAthlete.get(activity.athleteId) ?? [];
        list.push(activity);
        runsByAthlete.set(activity.athleteId, list);
    }

    const ytdBefore = new Map<number, number>();
    const ytdAfter = new Map<number, number>();
    for (const activity of ytd) {
        ytdAfter.set(activity.athleteId, (ytdAfter.get(activity.athleteId) ?? 0) + activity.distanceM);
        if (localDateOf(activity.startDateLocal) < weekStart) {
            ytdBefore.set(activity.athleteId, (ytdBefore.get(activity.athleteId) ?? 0) + activity.distanceM);
        }
    }
    // Only celebrate milestones reached by people who actually ran this week.
    for (const athleteId of ytdAfter.keys()) {
        if (!runsByAthlete.has(athleteId)) {
            ytdAfter.delete(athleteId);
        }
    }

    return {
        version: 1,
        club: {
            slug: club.slug,
            name: club.name,
            locale: club.locale,
            branding: club.branding,
        },
        week: {
            start: weekStart,
            end: weekEnd,
            label: formatWeekLabel(weekStart, club.locale),
            year,
        },
        generatedAt: (input.generatedAt ?? new Date()).toISOString(),
        group: {
            week: totalsFor(week),
            previousWeek: totalsFor(previousWeek),
            ytd: { ...totalsFor(ytd), goalKm: club.ytdGoalKm },
        },
        awards: club.awards.map((award) => buildAward(award, runsByAthlete, names, club.rules)),
        milestones: buildMilestones(ytdBefore, ytdAfter, names, club.milestonesKm),
    };
}
