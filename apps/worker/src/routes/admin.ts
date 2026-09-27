import { todayIn } from '@club-recap/core';
import { getClub } from '../../../../config/clubs/index.ts';
import { safeEqual } from '../crypto.ts';
import { Repository } from '../db.ts';
import type { MembershipStatus } from '../db.ts';
import type { Env } from '../env.ts';
import { error, json } from '../http.ts';
import { backfillAthlete, isBackingOff } from '../sync.ts';

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
    return json({ members: await repo.listMembers(slug, yearStart) });
}

/** PUT /admin/clubs/:slug/members/:athleteId  body: { "status": "active" | "excluded" } */
export async function updateMember(request: Request, env: Env, slug: string, athleteId: number): Promise<Response> {
    if (!getClub(slug)) {
        return error(404, 'Unknown club');
    }
    const body = (await request.json().catch(() => ({}))) as { status?: MembershipStatus };
    if (body.status !== 'active' && body.status !== 'excluded') {
        return error(400, 'status must be "active" or "excluded"');
    }
    const updated = await new Repository(env).setStatus(slug, athleteId, body.status);
    return updated ? json({ ok: true }) : error(404, 'Member not found');
}

/** POST /admin/athletes/:athleteId/resync — re-pulls the athlete's whole year. */
export function resyncAthlete(env: Env, ctx: ExecutionContext, athleteId: number): Response {
    ctx.waitUntil(backfillAthlete(env, athleteId));
    return json({ ok: true, message: 'Resync started' }, { status: 202 });
}

/** GET /admin/status */
export async function status(env: Env): Promise<Response> {
    const repo = new Repository(env);
    return json({ ...(await repo.counts()), backingOff: await isBackingOff(repo) });
}
