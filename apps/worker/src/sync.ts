import { addDays, todayIn } from '@club-recap/core';
import { getClub } from '../../../config/clubs/index.ts';
import { Repository } from './db.ts';
import { disconnectAthlete } from './disconnect.ts';
import type { Env } from './env.ts';
import {
    BudgetExhaustedError,
    NotFoundError,
    RateLimitedError,
    STORED_SPORT_TYPES,
    StravaClient,
    hasBestEfforts,
    nextWindowReset,
    toRecord,
} from './strava.ts';
import type { StravaActivity } from './strava.ts';

const BACKOFF_KEY = 'strava_backoff_until';
const DAY_S = 86_400;

export interface StravaWebhookEvent {
    object_type: 'activity' | 'athlete';
    object_id: number;
    aspect_type: 'create' | 'update' | 'delete';
    owner_id: number;
    subscription_id: number;
    event_time: number;
    updates?: Record<string, string>;
}

export async function isBackingOff(repo: Repository): Promise<boolean> {
    const until = await repo.getState(BACKOFF_KEY);
    return until !== null && new Date(until).getTime() > Date.now();
}

async function backOff(repo: Repository, minutes = 15): Promise<void> {
    await repo.setState(BACKOFF_KEY, new Date(Date.now() + minutes * 60_000).toISOString());
}

/** Pauses until Strava resets the window we are close to running out of. */
async function backOffUntilReset(repo: Repository, window: 'short' | 'daily'): Promise<void> {
    await repo.setState(BACKOFF_KEY, nextWindowReset(window).toISOString());
}

function isStorable(activity: StravaActivity): boolean {
    return STORED_SPORT_TYPES.has(activity.sport_type) && !activity.private;
}

/** Fetches one activity in detail (for best efforts) and stores or removes it. */
async function fetchAndStore(repo: Repository, client: StravaClient, token: string, activityId: number): Promise<void> {
    try {
        const activity = await client.activity(token, activityId);
        if (isStorable(activity)) {
            await repo.saveActivity(toRecord(activity), hasBestEfforts(activity));
        } else {
            await repo.deleteActivity(activityId);
        }
    } catch (error) {
        // Gone, or now "only me": we can no longer see it, so we must not keep it.
        if (error instanceof NotFoundError) {
            await repo.deleteActivity(activityId);
            return;
        }
        throw error;
    }
}

interface SyncOptions {
    /** Pull activities that started after this Unix time. */
    afterEpoch: number;
    /** Fetch full detail (best efforts) for runs on or after this date. */
    detailSince: string;
    detailLimit: number;
    maxPages: number;
}

/**
 * Weekly check that the runner is still in each club's Strava group. Returns false if they were removed entirely.
 * A leaver is only ever identified by a successful /athlete/clubs response that lacks the club: any failure,
 * including a rate limit, throws out of client.clubs() before we get here.
 */
export async function verifyMemberships(repo: Repository, client: StravaClient, token: string, athleteId: number): Promise<boolean> {
    const dueSlugs = await repo.membershipsDueForVerification(athleteId, 7);
    if (!dueSlugs.length) {
        return true;
    }
    const clubIds = new Set((await client.clubs(token)).map((c) => c.id));
    let remaining = -1;
    for (const slug of dueSlugs) {
        const club = getClub(slug);
        if (club && clubIds.has(club.stravaClubId)) {
            await repo.markVerified(slug, athleteId);
        } else if (club) {
            remaining = await repo.leaveClub(slug, athleteId);
        }
    }
    if (remaining === 0) {
        await disconnectAthlete(repo, client, athleteId);
        return false;
    }
    return true;
}

/** Pulls an athlete's recent activities and fills in best efforts, after re-checking club membership. */
export async function syncAthlete(env: Env, client: StravaClient, athleteId: number, options: SyncOptions): Promise<void> {
    const repo = new Repository(env);
    const token = await repo.accessToken(athleteId, client);
    if (!token) {
        return;
    }

    // Check club membership before pulling any data, so someone who has left never has more stored.
    if (!(await verifyMemberships(repo, client, token, athleteId))) {
        return;
    }

    for (let page = 1; page <= options.maxPages; page++) {
        const activities = await client.activities(token, options.afterEpoch, page);
        for (const activity of activities) {
            if (isStorable(activity)) {
                await repo.saveActivity(toRecord(activity), false);
            }
        }
        if (activities.length < 200) {
            break;
        }
    }

    const needDetail = await repo.activitiesNeedingDetail(athleteId, options.detailSince, options.detailLimit);
    for (const id of needDetail) {
        if (client.remaining < 2) {
            break;
        }
        await fetchAndStore(repo, client, token, id);
    }

    await repo.markSynced(athleteId);
}

/** Run right after someone connects: loads this year's runs so YTD totals are complete. */
export async function backfillAthlete(env: Env, athleteId: number): Promise<void> {
    const client = new StravaClient(env);
    const repo = new Repository(env);
    const now = Math.floor(Date.now() / 1000);
    const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
    try {
        await syncAthlete(env, client, athleteId, {
            // Go back to 1 January, plus a little extra so early-January weeks can compare with the week before.
            afterEpoch: Math.min(yearStart - 8 * DAY_S, now - 21 * DAY_S),
            detailSince: addDays(todayIn('UTC'), -14),
            detailLimit: 10,
            maxPages: 5,
        });
    } catch (error) {
        if (error instanceof RateLimitedError) {
            await backOff(repo);
        }
        console.error('Backfill failed', athleteId, error);
    }
}

export async function handleWebhookEvent(env: Env, event: StravaWebhookEvent): Promise<void> {
    const repo = new Repository(env);

    if (event.object_type === 'athlete') {
        // Runner revoked access in their Strava settings: delete everything we hold.
        if (event.updates?.authorized === 'false') {
            await repo.deleteAthlete(event.owner_id);
        }
        return;
    }

    if (event.aspect_type === 'delete') {
        await repo.deleteActivity(event.object_id);
        return;
    }

    // Title-only edits change nothing we store.
    const updatedKeys = Object.keys(event.updates ?? {});
    if (event.aspect_type === 'update' && updatedKeys.length > 0 && updatedKeys.every((k) => k === 'title')) {
        return;
    }

    if (!(await repo.isConnected(event.owner_id)) || (await isBackingOff(repo))) {
        return;
    }

    const client = new StravaClient(env, 5);
    try {
        const token = await repo.accessToken(event.owner_id, client);
        if (token) {
            await fetchAndStore(repo, client, token, event.object_id);
        }
    } catch (error) {
        if (error instanceof RateLimitedError) {
            await backOff(repo);
        }
        console.error('Webhook processing failed', event, error);
    }
}

/**
 * Hourly safety net. Webhooks can be missed, so each run re-syncs the few athletes
 * who have gone longest without a sync. With ~8 per hour, 200 athletes are each covered daily.
 */
export async function runScheduledSync(env: Env): Promise<void> {
    const repo = new Repository(env);
    if (await isBackingOff(repo)) {
        console.log('Skipping scheduled sync: backing off after a Strava rate limit');
        return;
    }

    const client = new StravaClient(env);
    const athleteIds = await repo.athletesDueForSync(8, 12);
    const now = Math.floor(Date.now() / 1000);

    for (const athleteId of athleteIds) {
        if (client.remaining < 5) {
            break;
        }
        // Stop the batch early when close to either Strava window, and stay quiet until it resets.
        const near = client.nearRateLimit();
        if (near) {
            console.log(`Stopping scheduled sync: close to the Strava ${near} rate limit`);
            await backOffUntilReset(repo, near);
            return;
        }
        try {
            await syncAthlete(env, client, athleteId, {
                afterEpoch: now - 4 * DAY_S,
                detailSince: addDays(todayIn('UTC'), -10),
                detailLimit: 3,
                maxPages: 1,
            });
        } catch (error) {
            if (error instanceof RateLimitedError) {
                await backOff(repo);
                return;
            }
            if (error instanceof BudgetExhaustedError) {
                return;
            }
            console.error('Scheduled sync failed for athlete', athleteId, error);
            // Don't let one broken athlete block the queue.
            await repo.markSynced(athleteId);
        }
    }

    // The last athlete may have taken us over the line.
    const near = client.nearRateLimit();
    if (near) {
        await backOffUntilReset(repo, near);
    }
}
