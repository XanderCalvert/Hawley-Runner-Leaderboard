import type { Env } from './env.ts';
import { error, json, preflight, withCors } from './http.ts';
import { isAdmin, listMembers, resyncAthlete, status, updateMember } from './routes/admin.ts';
import { clubInfo, clubSummary } from './routes/api.ts';
import { authCallback, startAuth } from './routes/auth.ts';
import { receiveWebhook, verifyWebhook } from './routes/webhook.ts';
import { runScheduledSync } from './sync.ts';

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;
    let match: RegExpMatchArray | null;

    if (pathname === '/' && method === 'GET') {
        return json({ name: 'club-recap', ok: true });
    }

    // Strava OAuth
    if (pathname === '/auth/start' && method === 'GET') {
        return startAuth(request, env);
    }
    if (pathname === '/auth/callback' && method === 'GET') {
        return authCallback(request, env, ctx);
    }

    // Strava webhooks
    if (pathname === '/webhook' && method === 'GET') {
        return verifyWebhook(request, env);
    }
    if (pathname === '/webhook' && method === 'POST') {
        return receiveWebhook(request, env, ctx);
    }

    // Public API
    if ((match = pathname.match(/^\/api\/clubs\/([a-z0-9-]+)\/summary$/)) && method === 'GET') {
        return clubSummary(request, env, match[1] as string);
    }
    if ((match = pathname.match(/^\/api\/clubs\/([a-z0-9-]+)$/)) && method === 'GET') {
        return clubInfo(match[1] as string);
    }

    // Admin API
    if (pathname.startsWith('/admin/')) {
        if (!(await isAdmin(request, env))) {
            return error(401, 'Unauthorised');
        }
        if (pathname === '/admin/status' && method === 'GET') {
            return status(env);
        }
        if ((match = pathname.match(/^\/admin\/clubs\/([a-z0-9-]+)\/members$/)) && method === 'GET') {
            return listMembers(env, match[1] as string);
        }
        if ((match = pathname.match(/^\/admin\/clubs\/([a-z0-9-]+)\/members\/(\d+)$/)) && method === 'PUT') {
            return updateMember(request, env, match[1] as string, Number(match[2]));
        }
        if ((match = pathname.match(/^\/admin\/athletes\/(\d+)\/resync$/)) && method === 'POST') {
            return resyncAthlete(env, ctx, Number(match[1]));
        }
    }

    return error(404, 'Not found');
}

export default {
    async fetch(request, env, ctx): Promise<Response> {
        if (request.method === 'OPTIONS') {
            return preflight(request, env);
        }
        try {
            return withCors(request, env, await route(request, env, ctx));
        } catch (err) {
            console.error(err);
            return withCors(request, env, error(500, 'Something went wrong'));
        }
    },

    async scheduled(_controller, env, ctx): Promise<void> {
        ctx.waitUntil(runScheduledSync(env));
    },
} satisfies ExportedHandler<Env>;
