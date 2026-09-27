/**
 * A tiny fake Strava for local development: OAuth, club list, activities and activity detail.
 * Run with `node scripts/mock-strava.ts`, then set STRAVA_BASE_URL=http://localhost:8788 in apps/worker/.dev.vars.
 * Each visit to /oauth/authorize signs in as the next fake runner. Every 10th runner is not a club member.
 */
import { createServer } from 'node:http';
import { fakeActivities, fakeAthletes } from './lib/fake-runners.ts';

const PORT = Number(process.env.MOCK_PORT ?? 8788);
const CLUB_ID = Number(process.env.MOCK_CLUB_ID ?? 0);
const athletes = fakeAthletes(30);
const today = new Date().toISOString().slice(0, 10);
const activities = fakeActivities(athletes, '2025-12-20', today);
let nextAthlete = 0;

function athleteFromToken(header: string | undefined) {
    const id = Number(/^Bearer tok-(\d+)-/.exec(header ?? '')?.[1]);
    return athletes.find((a) => a.id === id);
}

function send(res: import('node:http').ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, string>> {
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
    }
    return raw ? JSON.parse(raw) : {};
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
        return send(res, 200, { ...tokens(athlete.id), athlete });
    }

    if (path === '/oauth/deauthorize') {
        return send(res, 200, {});
    }

    const athlete = athleteFromToken(req.headers.authorization);
    if (!athlete) {
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
