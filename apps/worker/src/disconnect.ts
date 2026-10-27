import type { Repository } from './db.ts';
import type { StravaClient } from './strava.ts';

interface ExtraToken {
    token: string;
    hint: 'access_token' | 'refresh_token';
}

/**
 * Deletes everything we hold about an athlete, then revokes their access at Strava.
 * Our rows go first: a failed revoke is logged but never leaves their data behind.
 * Only the hide list survives (club + athlete ID, no personal data).
 */
export async function disconnectAthlete(
    repo: Repository,
    client: StravaClient,
    athleteId: number,
    extra: ExtraToken[] = [],
): Promise<void> {
    const stored = await repo.refreshToken(athleteId).catch(() => null);
    await repo.deleteAthlete(athleteId);

    const tokens: ExtraToken[] = [...(stored ? [{ token: stored, hint: 'refresh_token' as const }] : []), ...extra];
    for (const { token, hint } of tokens) {
        try {
            await client.revoke(token, hint);
        } catch (error) {
            console.error('Could not revoke Strava access for athlete', athleteId, error);
        }
    }
}
