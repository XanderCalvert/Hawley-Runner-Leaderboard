export type AwardMetric =
    | 'best5k'
    | 'longestRun'
    | 'distanceTotal'
    | 'elevationTotal'
    | 'runCount'
    | 'movingTimeTotal';

export interface AwardConfig {
    id: string;
    label: string;
    metric: AwardMetric;
    top: number;
    /** Only runs of these sport_type values count towards this award (default: every type the club counts). */
    sportTypes?: string[];
}

export interface ClubRules {
    /** Strava sport_type values that count, e.g. Run, TrailRun, VirtualRun. */
    sportTypes: string[];
    /** Count runs flagged by Strava as trainer/treadmill. */
    includeTreadmill: boolean;
    /** Count manually entered activities (never eligible for pace-based awards). */
    includeManual: boolean;
    /** Ignore anything shorter than this. */
    minDistanceM: number;
    /** Anything faster on average than this pace is treated as mis-tagged (e.g. a bike ride). */
    minPaceSecondsPerKm: number;
}

export interface ClubBranding {
    background: string;
    surface: string;
    text: string;
    muted: string;
    primary: string;
    accent: string;
    /** Emblem shown top right of the card (the week number then moves onto the date line). */
    logo: string | null;
    /** Light-on-dark wordmark image used instead of the club name text. */
    wordmark?: string | null;
    /** Colour of the slanted band behind the header (defaults to primary). */
    band?: string | null;
    /** Opacity of that band, 0–1 (default 0.16). */
    bandOpacity?: number;
    hashtag: string | null;
    footer: string | null;
}

/** A label an admin can put runners in (e.g. Women), shown as its own leaders panel on the first card. */
export interface ClubGroup {
    id: string;
    label: string;
    /** Panel heading, e.g. "Women's leaders". */
    title: string;
    /** Put runners in this group automatically when Strava says this is their sex on connecting (an admin can still change it). */
    stravaSex?: 'M' | 'F';
}

export interface ClubConfig {
    slug: string;
    name: string;
    stravaClubId: number;
    /** Public club page, used in captions. */
    stravaUrl?: string;
    /** Where runners connect their Strava to the leaderboard (the site's connect page). Linked in the post caption. */
    joinUrl?: string;
    /** Let people who are not in the Strava club ask to join, pending an admin's approval (default: they are turned away). */
    approveNonMembers?: boolean;
    /** Admin-assignable groups (optional). */
    groups?: ClubGroup[];
    timezone: string;
    locale: string;
    rules: ClubRules;
    awards: AwardConfig[];
    ytdGoalKm: number | null;
    milestonesKm: number[];
    /** Lifetime distance milestones to celebrate on the achievements card. */
    lifetimeMilestonesKm?: number[];
    branding: ClubBranding;
}

/** The minimum we keep about an activity (no titles, maps or locations). */
export interface ActivityRecord {
    id: number;
    athleteId: number;
    sportType: string;
    /** Strava start_date_local, e.g. 2026-09-21T07:30:00 (local wall-clock time). */
    startDateLocal: string;
    distanceM: number;
    movingTimeS: number;
    elevationGainM: number;
    manual: boolean;
    trainer: boolean;
    flagged: boolean;
    /** Best 5K effort within the activity, in seconds (from the detailed activity). */
    best5kS: number | null;
    /** Distances where Strava ranked this run as a new personal best, e.g. ['5K', '10K'] (from the detailed activity). */
    prEfforts?: string[];
    /** Two-letter country from the activity's time zone ("GB" = UK, "XX" = abroad but unknown), or null if unknown. */
    country?: string | null;
}

export interface AthleteRecord {
    id: number;
    displayName: string;
}

export interface Totals {
    runners: number;
    runs: number;
    distanceM: number;
    movingTimeS: number;
    elevationM: number;
}

export interface AwardEntry {
    rank: number;
    name: string;
    value: number;
    display: string;
}

export interface AwardResult {
    id: string;
    label: string;
    metric: AwardMetric;
    entries: AwardEntry[];
    /** Runners tied with the last entry shown who did not fit on the podium. */
    moreTied: number;
}

export interface Milestone {
    name: string;
    km: number;
}

export interface WeeklySummary {
    version: 1;
    club: {
        slug: string;
        name: string;
        stravaUrl?: string;
        joinUrl?: string;
        locale: string;
        branding: ClubBranding;
    };
    week: {
        start: string;
        end: string;
        label: string;
        year: number;
    };
    generatedAt: string;
    group: {
        week: Totals;
        previousWeek: Totals;
        ytd: Totals & { goalKm: number | null };
    };
    awards: AwardResult[];
    milestones: Milestone[];
}
