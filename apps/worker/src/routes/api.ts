import { addDays, buildWeeklySummary, isValidDate, lastCompletedWeekStart, weekEndOf, weekStartOf } from '@club-recap/core';
import { getClub } from '../../../../config/clubs/index.ts';
import { Repository } from '../db.ts';
import type { Env } from '../env.ts';
import { error, json } from '../http.ts';

/**
 * GET /api/clubs/:slug/summary?week=YYYY-MM-DD
 * Public: returns only what goes on the infographic (first name + initial, awards and totals).
 */
export async function clubSummary(request: Request, env: Env, slug: string): Promise<Response> {
    const club = getClub(slug);
    if (!club) {
        return error(404, 'Unknown club');
    }

    const requested = new URL(request.url).searchParams.get('week');
    if (requested && !isValidDate(requested)) {
        return error(400, 'week must be a date in YYYY-MM-DD format');
    }
    const weekStart = requested ? weekStartOf(requested) : lastCompletedWeekStart(club.timezone);
    const weekEnd = weekEndOf(weekStart);
    const yearStart = `${weekEnd.slice(0, 4)}-01-01`;
    const from = [yearStart, addDays(weekStart, -7)].sort()[0] as string;

    const repo = new Repository(env);
    const [athletes, activities] = await Promise.all([
        repo.activeAthletes(club.slug),
        repo.clubActivities(club.slug, from, addDays(weekEnd, 1)),
    ]);

    const summary = buildWeeklySummary({ club, athletes, activities, weekStart });
    return json(summary, { headers: { 'Cache-Control': 'public, max-age=300' } });
}

/** GET /api/clubs/:slug — branding and public details for the connect page. */
export function clubInfo(slug: string): Response {
    const club = getClub(slug);
    if (!club) {
        return error(404, 'Unknown club');
    }
    return json({ slug: club.slug, name: club.name, branding: club.branding, stravaClubId: club.stravaClubId });
}
