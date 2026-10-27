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

/** Strava's two rate-limit windows: [15 minutes, daily]. */
export type RateLimitPair = [number, number];

export interface RateLimitStatus {
    limit: RateLimitPair;
    usage: RateLimitPair;
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

/** The app has reached its connected-athlete capacity (see Strava's athlete limit). */
export class AthleteLimitError extends Error {}

/**
 * Strava rejects a new athlete over the cap during the token exchange. The exact wording isn't documented
 * anywhere we rely on, so this matches on "limit" in a 400/403 and is kept in one place to adjust.
 */
export function isAthleteLimit(status: number, body: string): boolean {
    return (status === 400 || status === 403) && /limit/i.test(body);
}

/** Parses Strava's "15min,daily" header pair, e.g. "100,1000". */
export function parseRateLimitPair(value: string | null): RateLimitPair | null {
    const parts = (value ?? '').split(',').map((part) => Number(part.trim()));
    const [short, daily] = parts;
    return parts.length === 2 && Number.isFinite(short) && Number.isFinite(daily) ? [short as number, daily as number] : null;
}

/** Strava's windows reset on the quarter hour and at midnight UTC. Returns the next reset after `now`. */
export function nextWindowReset(window: 'short' | 'daily', now: Date = new Date()): Date {
    if (window === 'daily') {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    }
    const quarter = 15 * 60_000;
    return new Date((Math.floor(now.getTime() / quarter) + 1) * quarter);
}

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

    /** Last rate-limit headers Strava sent, if any. */
    rateLimit: RateLimitStatus | null = null;

    private get oauthBase(): string {
        return this.env.STRAVA_OAUTH_BASE ?? 'https://www.strava.com';
    }

    /** Configurable so the move to https://api-v3.strava.com is a one-line change. */
    private get apiBase(): string {
        return this.env.STRAVA_API_BASE ?? 'https://www.strava.com/api/v3';
    }

    /** Which window is at or beyond `fraction` of its limit, if either. The daily window wins as it resets last. */
    nearRateLimit(fraction = 0.8): 'short' | 'daily' | null {
        if (!this.rateLimit) {
            return null;
        }
        const { limit, usage } = this.rateLimit;
        if (usage[1] >= limit[1] * fraction) {
            return 'daily';
        }
        return usage[0] >= limit[0] * fraction ? 'short' : null;
    }

    private async send(url: string, init: RequestInit): Promise<Response> {
        if (this.used >= this.budget) {
            throw new BudgetExhaustedError();
        }
        this.used++;
        const response = await fetch(url, init);
        const limit = parseRateLimitPair(response.headers.get('X-RateLimit-Limit'));
        const usage = parseRateLimitPair(response.headers.get('X-RateLimit-Usage'));
        if (limit && usage) {
            this.rateLimit = { limit, usage };
        }
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
        return `${this.oauthBase}/oauth/authorize?${params}`;
    }

    private async token(body: Record<string, string>): Promise<TokenResponse> {
        const response = await this.send(`${this.oauthBase}/oauth/token`, {
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
            const text = await response.text().catch(() => '');
            if (isAthleteLimit(response.status, text)) {
                throw new AthleteLimitError();
            }
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

    /**
     * Revokes the runner's access at Strava. Revoking either token of a pair revokes both.
     * 200 (empty body) means done whether or not the token existed; 503 is safe to retry.
     */
    async revoke(token: string, hint?: 'access_token' | 'refresh_token'): Promise<void> {
        const form = new URLSearchParams({ token });
        if (hint) {
            form.set('token_type_hint', hint);
        }
        const basic = btoa(`${this.env.STRAVA_CLIENT_ID}:${this.env.STRAVA_CLIENT_SECRET}`);
        for (let attempt = 1; ; attempt++) {
            const response = await this.send(`${this.oauthBase}/oauth/revoke`, {
                method: 'POST',
                headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form,
            });
            if (response.ok) {
                return;
            }
            if (response.status !== 503 || attempt >= 3) {
                throw new Error(`Strava revoke failed: ${response.status}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
    }

    private async get<T>(accessToken: string, path: string): Promise<T> {
        const response = await this.send(`${this.apiBase}${path}`, {
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

    /** Throws on any failure, so callers can never mistake an error for "not a member". */
    async clubs(accessToken: string): Promise<StravaClub[]> {
        const clubs = await this.get<unknown>(accessToken, '/athlete/clubs?per_page=200');
        if (!Array.isArray(clubs)) {
            throw new Error('Strava /athlete/clubs did not return a list');
        }
        return clubs as StravaClub[];
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
    };
}

export function hasBestEfforts(activity: StravaActivity): boolean {
    return Array.isArray(activity.best_efforts);
}
