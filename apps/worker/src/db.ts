import { displayName } from '@club-recap/core';
import type { ActivityRecord, AthleteRecord } from '@club-recap/core';
import { decrypt, encrypt } from './crypto.ts';
import type { Env } from './env.ts';
import { TokenRevokedError } from './strava.ts';
import type { StravaAthlete, StravaClient, TokenResponse } from './strava.ts';

export type MemberStatus = 'active' | 'hidden';

interface AthleteRow {
    id: number;
    firstname: string | null;
    lastname_initial: string | null;
    access_token: string;
    refresh_token: string;
    expires_at: number;
    last_synced_at: string | null;
}

interface ActivityRow {
    id: number;
    athlete_id: number;
    sport_type: string;
    start_date_local: string;
    distance_m: number;
    moving_time_s: number;
    elevation_gain_m: number;
    manual: number;
    trainer: number;
    flagged: number;
    best_5k_s: number | null;
}

export class Repository {
    constructor(private readonly env: Env) {}

    private get db(): D1Database {
        return this.env.DB;
    }

    /* ---------- Athletes & tokens ---------- */

    /** Stores the first name and surname initial only; the full surname is never kept. */
    async saveAthlete(athlete: StravaAthlete, tokens: TokenResponse, scope: string): Promise<void> {
        const [access, refresh] = await Promise.all([
            encrypt(this.env.APP_SECRET, tokens.access_token),
            encrypt(this.env.APP_SECRET, tokens.refresh_token),
        ]);
        await this.db
            .prepare(
                `INSERT INTO athletes (id, firstname, lastname_initial, access_token, refresh_token, expires_at, scope)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT (id) DO UPDATE SET
                    firstname = excluded.firstname,
                    lastname_initial = excluded.lastname_initial,
                    access_token = excluded.access_token,
                    refresh_token = excluded.refresh_token,
                    expires_at = excluded.expires_at,
                    scope = excluded.scope`,
            )
            .bind(
                athlete.id,
                athlete.firstname ?? null,
                (athlete.lastname ?? '').trim().charAt(0).toUpperCase() || null,
                access,
                refresh,
                tokens.expires_at,
                scope,
            )
            .run();
    }

    private async getAthleteRow(athleteId: number): Promise<AthleteRow | null> {
        return this.db.prepare('SELECT * FROM athletes WHERE id = ?1').bind(athleteId).first<AthleteRow>();
    }

    async isConnected(athleteId: number): Promise<boolean> {
        return (await this.getAthleteRow(athleteId)) !== null;
    }

    /** Returns a usable access token, refreshing (and persisting the rotated tokens) if needed. */
    async accessToken(athleteId: number, client: StravaClient): Promise<string | null> {
        const row = await this.getAthleteRow(athleteId);
        if (!row) {
            return null;
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (row.expires_at - 300 > nowSeconds) {
            return decrypt(this.env.APP_SECRET, row.access_token);
        }
        let refreshed: TokenResponse;
        try {
            refreshed = await client.refresh(await decrypt(this.env.APP_SECRET, row.refresh_token));
        } catch (error) {
            if (error instanceof TokenRevokedError) {
                await this.deleteAthlete(athleteId);
                return null;
            }
            throw error;
        }
        const [access, refresh] = await Promise.all([
            encrypt(this.env.APP_SECRET, refreshed.access_token),
            encrypt(this.env.APP_SECRET, refreshed.refresh_token),
        ]);
        await this.db
            .prepare('UPDATE athletes SET access_token = ?1, refresh_token = ?2, expires_at = ?3 WHERE id = ?4')
            .bind(access, refresh, refreshed.expires_at, athleteId)
            .run();
        return refreshed.access_token;
    }

    /** The stored refresh token, for revoking it at Strava. Revoking either token of a pair revokes both. */
    async refreshToken(athleteId: number): Promise<string | null> {
        const row = await this.getAthleteRow(athleteId);
        return row ? decrypt(this.env.APP_SECRET, row.refresh_token) : null;
    }

    /** Removes everything we hold about an athlete. The hide list is kept on purpose: it holds no personal data. */
    async deleteAthlete(athleteId: number): Promise<void> {
        await this.db.batch([
            this.db.prepare('DELETE FROM activities WHERE athlete_id = ?1').bind(athleteId),
            this.db.prepare('DELETE FROM memberships WHERE athlete_id = ?1').bind(athleteId),
            this.db.prepare('DELETE FROM athletes WHERE id = ?1').bind(athleteId),
        ]);
    }

    async markSynced(athleteId: number): Promise<void> {
        await this.db.prepare("UPDATE athletes SET last_synced_at = datetime('now') WHERE id = ?1").bind(athleteId).run();
    }

    /** Athletes in at least one club, least recently synced first. */
    async athletesDueForSync(limit: number, olderThanHours: number): Promise<number[]> {
        const { results } = await this.db
            .prepare(
                `SELECT DISTINCT a.id, a.last_synced_at FROM athletes a
                 JOIN memberships m ON m.athlete_id = a.id
                 WHERE a.last_synced_at IS NULL OR a.last_synced_at < datetime('now', ?1)
                 ORDER BY a.last_synced_at IS NOT NULL, a.last_synced_at
                 LIMIT ?2`,
            )
            .bind(`-${olderThanHours} hours`, limit)
            .all<{ id: number }>();
        return results.map((r) => r.id);
    }

    /* ---------- Memberships ---------- */

    /** Opts an athlete in to a club. Hiding is separate (see setHidden), so a reconnect never un-hides anyone. */
    async joinClub(clubSlug: string, athleteId: number): Promise<void> {
        await this.db
            .prepare(
                `INSERT INTO memberships (club_slug, athlete_id) VALUES (?1, ?2)
                 ON CONFLICT (club_slug, athlete_id) DO UPDATE SET verified_at = datetime('now')`,
            )
            .bind(clubSlug, athleteId)
            .run();
    }

    /** Removes one club's membership and returns how many clubs the athlete is still in. */
    async leaveClub(clubSlug: string, athleteId: number): Promise<number> {
        await this.db.prepare('DELETE FROM memberships WHERE club_slug = ?1 AND athlete_id = ?2').bind(clubSlug, athleteId).run();
        const row = await this.db
            .prepare('SELECT COUNT(*) AS remaining FROM memberships WHERE athlete_id = ?1')
            .bind(athleteId)
            .first<{ remaining: number }>();
        return row?.remaining ?? 0;
    }

    async setHidden(clubSlug: string, athleteId: number, hidden: boolean): Promise<void> {
        await (hidden
            ? this.db.prepare('INSERT OR IGNORE INTO hidden (club_slug, athlete_id) VALUES (?1, ?2)').bind(clubSlug, athleteId)
            : this.db.prepare('DELETE FROM hidden WHERE club_slug = ?1 AND athlete_id = ?2').bind(clubSlug, athleteId)
        ).run();
    }

    async markVerified(clubSlug: string, athleteId: number): Promise<void> {
        await this.db
            .prepare("UPDATE memberships SET verified_at = datetime('now') WHERE club_slug = ?1 AND athlete_id = ?2")
            .bind(clubSlug, athleteId)
            .run();
    }

    async membershipsDueForVerification(athleteId: number, olderThanDays: number): Promise<string[]> {
        const { results } = await this.db
            .prepare("SELECT club_slug FROM memberships WHERE athlete_id = ?1 AND verified_at < datetime('now', ?2)")
            .bind(athleteId, `-${olderThanDays} days`)
            .all<{ club_slug: string }>();
        return results.map((r) => r.club_slug);
    }

    /** Opted-in club members who have not been hidden by an admin. */
    async activeAthletes(clubSlug: string): Promise<AthleteRecord[]> {
        const { results } = await this.db
            .prepare(
                `SELECT a.id, a.firstname, a.lastname_initial FROM athletes a
                 JOIN memberships m ON m.athlete_id = a.id
                 WHERE m.club_slug = ?1
                    AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.club_slug = m.club_slug AND h.athlete_id = a.id)`,
            )
            .bind(clubSlug)
            .all<{ id: number; firstname: string | null; lastname_initial: string | null }>();
        return results.map((r) => ({ id: r.id, displayName: displayName(r.firstname, r.lastname_initial) }));
    }

    /** Admin only. Includes hidden runners who have since disconnected (no name left, just the ID). */
    async listMembers(clubSlug: string, yearStart: string) {
        const { results } = await this.db
            .prepare(
                `SELECT m.athlete_id AS id, a.firstname AS firstname, a.lastname_initial AS initial, 1 AS connected,
                    EXISTS (SELECT 1 FROM hidden h WHERE h.club_slug = m.club_slug AND h.athlete_id = m.athlete_id) AS hidden,
                    m.joined_at AS joined_at, m.verified_at AS verified_at, a.last_synced_at AS last_synced_at,
                    (SELECT COUNT(*) FROM activities x WHERE x.athlete_id = a.id AND x.start_date_local >= ?2) AS runs_this_year
                 FROM memberships m JOIN athletes a ON a.id = m.athlete_id
                 WHERE m.club_slug = ?1
                 UNION ALL
                 SELECT h.athlete_id, NULL, NULL, 0, 1, NULL, NULL, NULL, 0
                 FROM hidden h
                 WHERE h.club_slug = ?1 AND h.athlete_id NOT IN (SELECT athlete_id FROM memberships WHERE club_slug = ?1)
                 ORDER BY firstname COLLATE NOCASE, initial COLLATE NOCASE, id`,
            )
            .bind(clubSlug, yearStart)
            .all<{
                id: number;
                firstname: string | null;
                initial: string | null;
                connected: number;
                hidden: number;
                joined_at: string | null;
                verified_at: string | null;
                last_synced_at: string | null;
                runs_this_year: number;
            }>();
        return results.map((r) => ({
            athleteId: r.id,
            name: r.connected ? displayName(r.firstname, r.initial) : null,
            connected: r.connected === 1,
            status: (r.hidden ? 'hidden' : 'active') satisfies MemberStatus,
            joinedAt: r.joined_at,
            verifiedAt: r.verified_at,
            lastSyncedAt: r.last_synced_at,
            runsThisYear: r.runs_this_year,
        }));
    }

    /* ---------- Activities ---------- */

    /**
     * Upserts an activity. Best efforts only come from the detailed endpoint, so a
     * summary-only update must not wipe values a previous detail fetch stored.
     */
    async saveActivity(record: ActivityRecord, fromDetail: boolean): Promise<void> {
        await this.db
            .prepare(
                `INSERT INTO activities (id, athlete_id, sport_type, start_date_local, distance_m, moving_time_s,
                    elevation_gain_m, manual, trainer, flagged, best_5k_s, detail_fetched_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    CASE WHEN ?12 = 1 THEN datetime('now') END, datetime('now'))
                 ON CONFLICT (id) DO UPDATE SET
                    sport_type = excluded.sport_type,
                    start_date_local = excluded.start_date_local,
                    distance_m = excluded.distance_m,
                    moving_time_s = excluded.moving_time_s,
                    elevation_gain_m = excluded.elevation_gain_m,
                    manual = excluded.manual,
                    trainer = excluded.trainer,
                    flagged = excluded.flagged,
                    best_5k_s = CASE WHEN ?12 = 1 THEN excluded.best_5k_s ELSE activities.best_5k_s END,
                    detail_fetched_at = CASE WHEN ?12 = 1 THEN datetime('now') ELSE activities.detail_fetched_at END,
                    updated_at = datetime('now')`,
            )
            .bind(
                record.id,
                record.athleteId,
                record.sportType,
                record.startDateLocal,
                record.distanceM,
                record.movingTimeS,
                record.elevationGainM,
                record.manual ? 1 : 0,
                record.trainer ? 1 : 0,
                record.flagged ? 1 : 0,
                record.best5kS,
                fromDetail ? 1 : 0,
            )
            .run();
    }

    async deleteActivity(activityId: number): Promise<void> {
        await this.db.prepare('DELETE FROM activities WHERE id = ?1').bind(activityId).run();
    }

    /** Recent runs long enough to contain a 5K best effort that we have not fetched in detail yet. */
    async activitiesNeedingDetail(athleteId: number, sinceDate: string, limit: number): Promise<number[]> {
        const { results } = await this.db
            .prepare(
                `SELECT id FROM activities
                 WHERE athlete_id = ?1 AND detail_fetched_at IS NULL AND manual = 0
                    AND distance_m >= 5000 AND start_date_local >= ?2
                 ORDER BY start_date_local DESC LIMIT ?3`,
            )
            .bind(athleteId, sinceDate, limit)
            .all<{ id: number }>();
        return results.map((r) => r.id);
    }

    async clubActivities(clubSlug: string, from: string, to: string): Promise<ActivityRecord[]> {
        const { results } = await this.db
            .prepare(
                `SELECT x.* FROM activities x
                 JOIN memberships m ON m.athlete_id = x.athlete_id AND m.club_slug = ?1
                 WHERE x.start_date_local >= ?2 AND x.start_date_local < ?3
                    AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.club_slug = m.club_slug AND h.athlete_id = x.athlete_id)`,
            )
            .bind(clubSlug, from, to)
            .all<ActivityRow>();
        return results.map((r) => ({
            id: r.id,
            athleteId: r.athlete_id,
            sportType: r.sport_type,
            startDateLocal: r.start_date_local,
            distanceM: r.distance_m,
            movingTimeS: r.moving_time_s,
            elevationGainM: r.elevation_gain_m,
            manual: r.manual === 1,
            trainer: r.trainer === 1,
            flagged: r.flagged === 1,
            best5kS: r.best_5k_s,
        }));
    }

    /* ---------- Operational state ---------- */

    async getState(key: string): Promise<string | null> {
        const row = await this.db.prepare('SELECT value FROM app_state WHERE key = ?1').bind(key).first<{ value: string }>();
        return row?.value ?? null;
    }

    async setState(key: string, value: string): Promise<void> {
        await this.db
            .prepare('INSERT INTO app_state (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
            .bind(key, value)
            .run();
    }

    async counts() {
        return this.db
            .prepare(
                `SELECT (SELECT COUNT(*) FROM athletes) AS athletes,
                        (SELECT COUNT(*) FROM activities) AS activities,
                        (SELECT MAX(last_synced_at) FROM athletes) AS last_sync`,
            )
            .first<{ athletes: number; activities: number; last_sync: string | null }>();
    }
}
