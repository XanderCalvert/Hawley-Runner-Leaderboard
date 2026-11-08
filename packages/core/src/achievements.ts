import { addDays, localDateOf, weekStartOf } from './dates.ts';
import { isEligible } from './summary.ts';
import type { ActivityRecord, AthleteRecord, AwardEntry, ClubConfig } from './types.ts';

/** A ranked list (shared places for ties, "+N more tied" past the podium), like an award without a metric. */
export interface Ranking {
    id: string;
    label: string;
    entries: AwardEntry[];
    moreTied: number;
}

export interface Achievements {
    /** Runners who set a personal best this week, with the distances (shortest first). */
    prs: Array<{ name: string; efforts: string[] }>;
    /** Lifetime distance milestones crossed this week (highest per runner). */
    milestones: Array<{ name: string; km: number }>;
    /** Consecutive days with a run, for streaks that ended this week. */
    dayStreak: Ranking;
    /** Consecutive weeks with at least one run, up to and including this week. */
    weekStreak: Ranking;
    /** Countries outside the UK that recorded outdoor runs happened in this week (no names, no distances), most running first. Show nothing if empty. */
    international: { abroad: string[] };
}

export interface AchievementsInput {
    club: ClubConfig;
    /** Opted-in, club-member, not-hidden runners only. */
    athletes: AthleteRecord[];
    /** Everything stored for them from the start of the year (or earlier) up to the end of the week. */
    activities: ActivityRecord[];
    /**
     * Lifetime run distance before the first stored activity, per athlete (Strava's lifetime total minus what we hold).
     * Anyone missing is left out of the milestones.
     */
    lifetimeBaseM: Map<number, number>;
    weekStart: string;
}

/** Streaks shorter than this aren't worth a mention. */
const MIN_DAY_STREAK = 3;
const MIN_WEEK_STREAK = 4;
const TOP = 5;

/** Order the distances read in on the card, shortest first. */
const EFFORT_ORDER = ['1K', '1 mile', '5K', '10K', 'Half marathon', 'Marathon'];

function rank(id: string, label: string, scored: Array<{ name: string; value: number }>, unit: string): Ranking {
    const sorted = [...scored].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const entries: AwardEntry[] = [];
    let moreTied = 0;
    let previous: number | null = null;
    let place = 0;
    sorted.forEach((row, index) => {
        if (row.value !== previous) {
            place = index + 1;
            previous = row.value;
        }
        if (place > TOP) {
            return;
        }
        if (entries.length >= TOP) {
            moreTied++;
            return;
        }
        entries.push({ rank: place, name: row.name, value: row.value, display: `${row.value} ${unit}` });
    });
    return { id, label, entries, moreTied };
}

/** Length of the run of consecutive days ending on `last`, within `days` (a set of YYYY-MM-DD). */
function streakEndingOn(days: Set<string>, last: string): number {
    let length = 0;
    for (let day = last; days.has(day); day = addDays(day, -1)) {
        length++;
    }
    return length;
}

export function buildAchievements({ club, athletes, activities, lifetimeBaseM, weekStart }: AchievementsInput): Achievements {
    const weekEnd = addDays(weekStart, 6);
    const names = new Map(athletes.map((a) => [a.id, a.displayName]));
    const prTypes = club.awards.find((a) => a.metric === 'best5k')?.sportTypes;
    const milestoneSteps = club.lifetimeMilestonesKm ?? [];

    const eligible = new Map<number, ActivityRecord[]>();
    const everything = new Map<number, ActivityRecord[]>();
    for (const activity of activities) {
        if (!names.has(activity.athleteId) || localDateOf(activity.startDateLocal) > weekEnd) {
            continue;
        }
        everything.set(activity.athleteId, [...(everything.get(activity.athleteId) ?? []), activity]);
        if (isEligible(activity, club.rules)) {
            eligible.set(activity.athleteId, [...(eligible.get(activity.athleteId) ?? []), activity]);
        }
    }

    const prs: Achievements['prs'] = [];
    const milestones: Achievements['milestones'] = [];
    const dayScores: Array<{ name: string; value: number }> = [];
    const weekScores: Array<{ name: string; value: number }> = [];

    for (const [athleteId, name] of names) {
        const runs = eligible.get(athleteId) ?? [];
        const days = new Set(runs.map((r) => localDateOf(r.startDateLocal)));

        // Streaks: the run of consecutive days ending on their last running day this week.
        const lastDayThisWeek = [...days].filter((d) => d >= weekStart).sort().at(-1);
        const dayStreak = lastDayThisWeek ? streakEndingOn(days, lastDayThisWeek) : 0;
        if (dayStreak >= MIN_DAY_STREAK) {
            dayScores.push({ name, value: dayStreak });
        }
        const weeks = new Set([...days].map(weekStartOf));
        let weekStreak = 0;
        for (let w = weekStart; weeks.has(w); w = addDays(w, -7)) {
            weekStreak++;
        }
        if (weekStreak >= MIN_WEEK_STREAK) {
            weekScores.push({ name, value: weekStreak });
        }

        // Personal bests: only from recorded outdoor runs, and only those started this week.
        const efforts = new Set(
            runs
                .filter((r) => !r.manual && localDateOf(r.startDateLocal) >= weekStart && (!prTypes || prTypes.includes(r.sportType)))
                .flatMap((r) => r.prEfforts ?? []),
        );
        if (efforts.size) {
            prs.push({ name, efforts: EFFORT_ORDER.filter((e) => efforts.has(e)) });
        }

        // Lifetime milestones: base + what we hold before the week, against base + what we hold by the end of it.
        const base = lifetimeBaseM.get(athleteId);
        if (base !== undefined && milestoneSteps.length) {
            const all = everything.get(athleteId) ?? [];
            const before = base + all.filter((r) => localDateOf(r.startDateLocal) < weekStart).reduce((s, r) => s + r.distanceM, 0);
            const after = base + all.reduce((s, r) => s + r.distanceM, 0);
            const crossed = milestoneSteps.filter((km) => before < km * 1000 && after >= km * 1000).at(-1);
            if (crossed !== undefined) {
                milestones.push({ name, km: crossed });
            }
        }
    }

    // Club totals for the week: outdoor, recorded runs only, since a treadmill or virtual run says nothing about where someone was.
    const byCountry = new Map<string, number>();
    for (const runs of eligible.values()) {
        for (const r of runs) {
            if (localDateOf(r.startDateLocal) >= weekStart && !r.manual && !r.trainer && (r.sportType === 'Run' || r.sportType === 'TrailRun')) {
                const country = r.country ?? 'GB';
                byCountry.set(country, (byCountry.get(country) ?? 0) + r.distanceM);
            }
        }
    }
    // Only the countries are published: a distance in a place only one person went to would point at them.
    const international = { abroad: [...byCountry].filter(([c]) => c !== 'GB').sort((a, b) => b[1] - a[1]).map(([country]) => country) };

    prs.sort((a, b) => b.efforts.length - a.efforts.length || a.name.localeCompare(b.name));
    milestones.sort((a, b) => b.km - a.km || a.name.localeCompare(b.name));
    return {
        prs,
        milestones,
        dayStreak: rank('day-streak', 'Day streak', dayScores, 'days'),
        weekStreak: rank('week-streak', 'Weeks in a row', weekScores, 'weeks'),
        international,
    };
}
