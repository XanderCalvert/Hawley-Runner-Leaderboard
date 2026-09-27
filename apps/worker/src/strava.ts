import type { ActivityRecord } from '@club-recap/core';
import type { Env } from './env.ts';

/** Sport types we store at all. Clubs then filter further with their own rules. */
export const STORED_SPORT_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete?: StravaAthlete;
}

export interface StravaAthlete {
    id: number;
    firstname?: string;
    lastname?: string;
}

export interface StravaClub {
    id: number;
    name: string;
}

export interface StravaActivity {
    id: number;
    athlete: { id: number };
    sport_type: string;
    start_date_local: string;
    distance: number;
    moving_time: number;
    total_elevation_gain?: number;
    manual?: boolean;
    trainer?: boolean;
    flagged?: boolean;
    private?: boolean;
    best_efforts?: Array<{ name: string; distance: number; elapsed_time: number }>;
}

export class RateLimitedError extends Error {
    constructor() {
        super('Strava rate limit reached');
    }
}

export class BudgetExhaustedError extends Error {
    constructor() {
        super('Subrequest budget for this invocation is used up');
    }
}

export class NotFoundError extends Error {}

/** The refresh token was rejected: the runner has revoked access. */
export class TokenRevokedError extends Error {}

/**
 * Thin Strava client. Counts every outbound request so a single Worker invocation
 * never exceeds Cloudflare's free-plan subrequest limit (50).
 */
export class StravaClient {
    private used = 0;

    constructor(
        private readonly env: Env,
        private readonly budget = 45,
    ) {}

    get remaining(): number {
        return this.budget - this.used;
    }

    private get base(): string {
        return this.env.STRAVA_BASE_URL ?? 'https://www.strava.com';
    }

    private async send(url: string, init: RequestInit): Promise<Response> {
        if (this.used >= this.budget) {
            throw new BudgetExhaustedError();
        }
        this.used++;
        const response = await fetch(url, init);
        if (response.status === 429) {
            throw new RateLimitedError();
        }
        return response;
    }

    authoriseUrl(redirectUri: string, state: string): string {
        const params = new URLSearchParams({
            client_id: this.env.STRAVA_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            approval_prompt: 'auto',
            scope: 'read,activity:read',
            state,
        });
        return `${this.base}/oauth/authorize?${params}`;
    }

    private async token(body: Record<string, string>): Promise<TokenResponse> {
        const response = await this.send(`${this.base}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: this.env.STRAVA_CLIENT_ID,
                client_secret: this.env.STRAVA_CLIENT_SECRET,
                ...body,
            }),
        });
        if ((response.status === 400 || response.status === 401) && body.grant_type === 'refresh_token') {
            throw new TokenRevokedError();
        }
        if (!response.ok) {
            throw new Error(`Strava token request failed: ${response.status}`);
        }
        return response.json();
    }

    exchangeCode(code: string): Promise<TokenResponse> {
        return this.token({ code, grant_type: 'authorization_code' });
    }

    refresh(refreshToken: string): Promise<TokenResponse> {
        return this.token({ refresh_token: refreshToken, grant_type: 'refresh_token' });
    }

    async deauthorise(accessToken: string): Promise<void> {
        await this.send(`${this.base}/oauth/deauthorize`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
        });
    }

    private async get<T>(accessToken: string, path: string): Promise<T> {
        const response = await this.send(`${this.base}/api/v3${path}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.status === 404) {
            throw new NotFoundError(path);
        }
        if (!response.ok) {
            throw new Error(`Strava GET ${path} failed: ${response.status}`);
        }
        return response.json();
    }

    clubs(accessToken: string): Promise<StravaClub[]> {
        return this.get(accessToken, '/athlete/clubs?per_page=200');
    }

    activities(accessToken: string, afterEpoch: number, page: number): Promise<StravaActivity[]> {
        return this.get(accessToken, `/athlete/activities?after=${afterEpoch}&per_page=200&page=${page}`);
    }

    activity(accessToken: string, id: number): Promise<StravaActivity> {
        return this.get(accessToken, `/activities/${id}`);
    }
}

function bestEffort(activity: StravaActivity, metres: number): number | null {
    const effort = activity.best_efforts?.find((e) => Math.round(e.distance) === metres);
    return effort ? effort.elapsed_time : null;
}

/** Maps a Strava activity to the minimal record we keep. */
export function toRecord(activity: StravaActivity): ActivityRecord {
    return {
        id: activity.id,
        athleteId: activity.athlete.id,
        sportType: activity.sport_type,
        // Strava suffixes local times with "Z" even though they are wall-clock; strip it.
        startDateLocal: activity.start_date_local.replace(/Z$/, ''),
        distanceM: activity.distance,
        movingTimeS: activity.moving_time,
        elevationGainM: activity.total_elevation_gain ?? 0,
        manual: activity.manual ?? false,
        trainer: activity.trainer ?? false,
        flagged: activity.flagged ?? false,
        best5kS: bestEffort(activity, 5000),
        best10kS: bestEffort(activity, 10000),
    };
}

export function hasBestEfforts(activity: StravaActivity): boolean {
    return Array.isArray(activity.best_efforts);
}
