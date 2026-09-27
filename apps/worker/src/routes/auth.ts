import { getClub } from '../../../../config/clubs/index.ts';
import { signState, verifyState } from '../crypto.ts';
import { Repository } from '../db.ts';
import type { Env } from '../env.ts';
import { error, redirect } from '../http.ts';
import { StravaClient } from '../strava.ts';
import { backfillAthlete } from '../sync.ts';

type Intent = 'join' | 'leave';

interface OAuthState {
    club: string;
    intent: Intent;
    iat: number;
}

const STATE_MAX_AGE_MS = 15 * 60_000;

function resultUrl(env: Env, club: string, status: string): string {
    const params = new URLSearchParams({ club, status });
    return `${env.WEB_BASE_URL}/connected.html?${params}`;
}

/** GET /auth/start?club=hawley-runners[&intent=leave] → Strava consent screen. */
export async function startAuth(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const slug = url.searchParams.get('club') ?? '';
    const intent: Intent = url.searchParams.get('intent') === 'leave' ? 'leave' : 'join';
    if (!getClub(slug)) {
        return error(404, 'Unknown club');
    }
    const state = await signState(env.APP_SECRET, { club: slug, intent, iat: Date.now() } satisfies OAuthState);
    const client = new StravaClient(env);
    return redirect(client.authoriseUrl(`${url.origin}/auth/callback`, state));
}

/** GET /auth/callback — Strava sends the runner back here after they approve (or cancel). */
export async function authCallback(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const state = await verifyState<OAuthState>(env.APP_SECRET, url.searchParams.get('state') ?? '', STATE_MAX_AGE_MS);
    const club = state ? getClub(state.club) : undefined;
    if (!state || !club) {
        return error(400, 'This link has expired. Please start again from the club page.');
    }

    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') || !code) {
        return redirect(resultUrl(env, club.slug, 'cancelled'));
    }

    const scope = url.searchParams.get('scope') ?? '';
    const client = new StravaClient(env);
    const repo = new Repository(env);
    const tokens = await client.exchangeCode(code);
    const athlete = tokens.athlete;
    if (!athlete) {
        return error(502, 'Strava did not return an athlete.');
    }

    if (state.intent === 'leave') {
        await repo.deleteAthlete(athlete.id);
        await client.deauthorise(tokens.access_token);
        return redirect(resultUrl(env, club.slug, 'left'));
    }

    // We need activity:read to see their runs. Without it there is nothing to show.
    if (!scope.split(',').includes('activity:read') && !scope.split(',').includes('activity:read_all')) {
        await client.deauthorise(tokens.access_token);
        return redirect(resultUrl(env, club.slug, 'missing-scope'));
    }

    // Requirement: must be a member of the club's Strava group.
    const clubs = await client.clubs(tokens.access_token);
    if (!clubs.some((c) => c.id === club.stravaClubId)) {
        // Only deauthorise if they are not already connected through another club.
        if (!(await repo.isConnected(athlete.id))) {
            await client.deauthorise(tokens.access_token);
        }
        return redirect(resultUrl(env, club.slug, 'not-member'));
    }

    await repo.saveAthlete(athlete, tokens, scope);
    await repo.joinClub(club.slug, athlete.id);
    ctx.waitUntil(backfillAthlete(env, athlete.id));

    return redirect(resultUrl(env, club.slug, 'connected'));
}
