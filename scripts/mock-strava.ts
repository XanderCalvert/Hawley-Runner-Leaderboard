/**
 * A tiny fake Strava for local development: OAuth (token, revoke), club list, activities and activity detail.
 * Run with `node scripts/mock-strava.ts`, then set these in apps/worker/.dev.vars:
 *   STRAVA_OAUTH_BASE=http://localhost:8788
 *   STRAVA_API_BASE=http://localhost:8788/api/v3
 * MOCK_ATHLETE_LIMIT=3 makes new athletes beyond the third fail the token exchange, like Strava's capacity limit.
 * Each visit to /oauth/authorize signs in as the next fake runner. Every 10th runner is not a club member.
 */
import { createServer } from 'node:http';
import { fakeActivities, fakeAthletes } from './lib/fake-runners.ts';

const PORT = Number(process.env.MOCK_PORT ?? 8788);
const CLUB_ID = Number(process.env.MOCK_CLUB_ID ?? 0);
const ATHLETE_LIMIT = Number(process.env.MOCK_ATHLETE_LIMIT ?? Infinity);
const connected = new Set<number>();
const revoked = new Set<number>(); // athlete IDs whose access was revoked
const athletes = fakeAthletes(30);
const today = new Date().toISOString().slice(0, 10);
const activities = fakeActivities(athletes, '2025-12-20', today);
let nextAthlete = 0;

function athleteFromToken(header: string | undefined) {
    const id = Number(/^Bearer tok-(\d+)-/.exec(header ?? '')?.[1]);
    return athletes.find((a) => a.id === id);
}

function send(res: import('node:http').ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '1,1' });
    res.end(JSON.stringify(body));
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, string>> {
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
    }
    if (!raw) {
        return {};
    }
    // Strava accepts JSON or form-encoded bodies on the token endpoint; revoke is form-encoded.
    return req.headers['content-type']?.includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
}

function tokens(athleteId: number) {
    return {
        access_token: `tok-${athleteId}-${Date.now()}`,
        refresh_token: `ref-${athleteId}-${Date.now()}`,
        expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
    };
}

createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;
    console.log(req.method, path + url.search);

    if (path === '/oauth/authorize') {
        const athlete = athletes[nextAthlete++ % athletes.length];
        const back = new URL(url.searchParams.get('redirect_uri') ?? '');
        back.searchParams.set('state', url.searchParams.get('state') ?? '');
        back.searchParams.set('code', `mock-${athlete?.id}`);
        back.searchParams.set('scope', 'read,activity:read');
        res.writeHead(302, { Location: back.toString() });
        return res.end();
    }

    if (path === '/oauth/token' && req.method === 'POST') {
        const body = await readBody(req);
        const id = Number((body.code ?? body.refresh_token ?? '').split('-')[1]);
        const athlete = athletes.find((a) => a.id === id);
        if (!athlete) {
            return send(res, 400, { message: 'Bad Request' });
        }
        if (body.grant_type === 'refresh_token' && revoked.has(athlete.id)) {
            return send(res, 400, { message: 'Bad Request' });
        }
        if (body.grant_type === 'authorization_code' && !connected.has(athlete.id) && connected.size >= ATHLETE_LIMIT) {
            return send(res, 403, { message: 'Limit of connected athletes exceeded' });
        }
        connected.add(athlete.id);
        revoked.delete(athlete.id);
        return send(res, 200, { ...tokens(athlete.id), athlete });
    }

    // POST /oauth/revoke: HTTP Basic client auth, form body `token` (+ optional `token_type_hint`).
    // 200 with an empty body whether or not the token existed; 400 missing token; 401 bad auth.
    if (path === '/oauth/revoke' && req.method === 'POST') {
        const body = await readBody(req);
        if (!/^Basic .+/.test(req.headers.authorization ?? '')) {
            return send(res, 401, { message: 'Authorization Error' });
        }
        if (!body.token) {
            return send(res, 400, { message: 'Bad Request' });
        }
        // Revoking either token of a pair revokes both: tokens are keyed by athlete.
        const id = Number(body.token.split('-')[1]);
        connected.delete(id);
        revoked.add(id);
        res.writeHead(200);
        return res.end();
    }

    const athlete = athleteFromToken(req.headers.authorization);
    if (!athlete || revoked.has(athlete.id)) {
        return send(res, 401, { message: 'Authorization Error' });
    }

    if (path === '/api/v3/athlete/clubs') {
        const isMember = athlete.id % 10 !== 9;
        return send(res, 200, isMember ? [{ id: CLUB_ID, name: 'Hawley Runners' }] : [{ id: 12345, name: 'Another Club' }]);
    }

    if (path === '/api/v3/athlete/activities') {
        const after = Number(url.searchParams.get('after') ?? 0);
        const page = Number(url.searchParams.get('page') ?? 1);
        const perPage = Number(url.searchParams.get('per_page') ?? 30);
        const mine = activities
            .filter((a) => a.athlete.id === athlete.id && Date.parse(a.start_date) / 1000 > after)
            .map(({ best_efforts: _omit, ...summary }) => summary);
        return send(res, 200, mine.slice((page - 1) * perPage, page * perPage));
    }

    const detail = /^\/api\/v3\/activities\/(\d+)$/.exec(path);
    if (detail) {
        const activity = activities.find((a) => a.id === Number(detail[1]) && a.athlete.id === athlete.id);
        return activity ? send(res, 200, activity) : send(res, 404, { message: 'Record Not Found' });
    }

    send(res, 404, { message: 'Not found' });
}).listen(PORT, () => console.log(`Mock Strava on http://localhost:${PORT} (club id ${CLUB_ID})`));
