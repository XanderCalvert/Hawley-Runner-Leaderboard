import { todayIn } from '@club-recap/core';
import { getClub } from '../../../../config/clubs/index.ts';
import { safeEqual } from '../crypto.ts';
import { Repository } from '../db.ts';
import type { MemberStatus } from '../db.ts';
import type { Env } from '../env.ts';
import { error, json } from '../http.ts';
import { disconnectAthlete } from '../disconnect.ts';
import { StravaClient } from '../strava.ts';
import { backfillAthlete, isBackingOff, loadHistory } from '../sync.ts';

export async function isAdmin(request: Request, env: Env): Promise<boolean> {
    const header = request.headers.get('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return token.length > 0 && env.ADMIN_TOKEN.length >= 24 && safeEqual(token, env.ADMIN_TOKEN);
}

/** GET /admin/clubs/:slug/members */
export async function listMembers(env: Env, slug: string): Promise<Response> {
    const club = getClub(slug);
    if (!club) {
        return error(404, 'Unknown club');
    }
    const yearStart = `${todayIn(club.timezone).slice(0, 4)}-01-01`;
    const repo = new Repository(env);
    const members = await repo.listMembers(slug, yearStart);
    // Strava IDs and profile links are for admins only; the public summary never includes them.
    return json({ members: members.map((m) => ({ ...m, profileUrl: `https://www.strava.com/athletes/${m.athleteId}` })) });
}

/** PUT /admin/clubs/:slug/members/:athleteId  body: { "status"?: "active" | "hidden", "group"?: a group id from the club config, or null } */
export async function updateMember(request: Request, env: Env, slug: string, athleteId: number): Promise<Response> {
    const club = getClub(slug);
    if (!club) {
        return error(404, 'Unknown club');
    }
    const body = (await request.json().catch(() => ({}))) as { status?: MemberStatus; group?: string | null };
    const repo = new Repository(env);
    const hasStatus = body.status !== undefined;
    const hasGroup = body.group !== undefined;
    if (!hasStatus && !hasGroup) {
        return error(400, 'Send a status and/or a group');
    }
    if (hasStatus && body.status !== 'active' && body.status !== 'hidden') {
        return error(400, 'status must be "active" or "hidden"');
    }
    if (hasGroup && body.group !== null && !club.groups?.some((g) => g.id === body.group)) {
        return error(400, "group must be null or one of the club's group ids");
    }
    if (hasStatus) {
        await repo.setHidden(slug, athleteId, body.status === 'hidden');
    }
    if (hasGroup && !(await repo.setGroup(slug, athleteId, body.group as string | null))) {
        return error(404, 'Member not found');
    }
    return json({ ok: true });
}

/** POST /admin/clubs/:slug/members/:athleteId/approve: lets a pending runner on (as a guest) and loads their year. */
export async function approveMember(env: Env, ctx: ExecutionContext, slug: string, athleteId: number): Promise<Response> {
    if (!getClub(slug)) {
        return error(404, 'Unknown club');
    }
    if (!(await new Repository(env).approveGuest(slug, athleteId))) {
        return error(404, 'No pending request for that runner');
    }
    ctx.waitUntil(backfillAthlete(env, athleteId));
    return json({ ok: true });
}

/** POST /admin/clubs/:slug/members/:athleteId/remove: takes a runner (or rejects a pending request) off, and revokes their access at Strava. */
export async function removeMember(env: Env, slug: string, athleteId: number): Promise<Response> {
    if (!getClub(slug)) {
        return error(404, 'Unknown club');
    }
    const repo = new Repository(env);
    if ((await repo.getApproval(slug, athleteId)) === null) {
        return error(404, 'Member not found');
    }
    // Only fully disconnect them if this was their only club.
    if ((await repo.leaveClub(slug, athleteId)) === 0) {
        await disconnectAthlete(repo, new StravaClient(env), athleteId);
    }
    return json({ ok: true });
}

/**
 * POST /admin/clubs/:slug/members/:athleteId/check-club: asks Strava, with that runner's own token, whether they are in the
 * club's Strava group right now. Changes nothing: the admin decides what to do with the answer.
 */
export async function checkClub(env: Env, slug: string, athleteId: number): Promise<Response> {
    const club = getClub(slug);
    if (!club) {
        return error(404, 'Unknown club');
    }
    const repo = new Repository(env);
    const client = new StravaClient(env);
    const token = await repo.accessToken(athleteId, client);
    if (!token) {
        return error(404, 'That runner is not connected');
    }
    try {
        const clubs = await client.clubs(token);
        return json({ inClub: clubs.some((c) => c.id === club.stravaClubId), approval: await repo.getApproval(slug, athleteId) });
    } catch (e) {
        console.error('Club check failed', e);
        return error(502, "Strava didn't answer. Try again in a minute.");
    }
}

/** POST /admin/athletes/:athleteId/resync — re-pulls the athlete's whole year. */
export function resyncAthlete(env: Env, ctx: ExecutionContext, athleteId: number): Response {
    ctx.waitUntil(backfillAthlete(env, athleteId));
    return json({ ok: true, message: 'Resync started' }, { status: 202 });
}

/**
 * POST /admin/athletes/:athleteId/history?since=2025-01-01: loads one batch of that runner's older runs and best efforts.
 * Returns how many runs still need loading; the admin page calls it again until it reaches 0.
 */
export async function loadAthleteHistory(env: Env, athleteId: number, since: string | null): Promise<Response> {
    const from = since ?? '2025-01-01';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < '2015-01-01') {
        return error(400, 'since must be a date like 2025-01-01');
    }
    if (!(await new Repository(env).hasApprovedMembership(athleteId))) {
        return error(404, 'That runner is not connected');
    }
    return json(await loadHistory(env, athleteId, from));
}

/** GET /admin/status */
export async function status(env: Env): Promise<Response> {
    const repo = new Repository(env);
    return json({ ...(await repo.counts()), backingOff: await isBackingOff(repo) });
}
