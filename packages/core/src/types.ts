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

export interface ClubConfig {
    slug: string;
    name: string;
    stravaClubId: number;
    /** Public club page, used in captions. */
    stravaUrl?: string;
    timezone: string;
    locale: string;
    rules: ClubRules;
    awards: AwardConfig[];
    ytdGoalKm: number | null;
    milestonesKm: number[];
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
