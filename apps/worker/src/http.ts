import type { Env } from './env.ts';

export function json(data: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status: number, message: string): Response {
    return json({ error: message }, { status });
}

export function redirect(url: string): Response {
    return new Response(null, { status: 302, headers: { Location: url } });
}

function allowedOrigin(request: Request, env: Env): string | null {
    const origin = request.headers.get('Origin');
    if (!origin) {
        return null;
    }
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
    return allowed.includes(origin) ? origin : null;
}

export function withCors(request: Request, env: Env, response: Response): Response {
    const origin = allowedOrigin(request, env);
    if (!origin) {
        return response;
    }
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    return new Response(response.body, { status: response.status, headers });
}

export function preflight(request: Request, env: Env): Response {
    const origin = allowedOrigin(request, env);
    if (!origin) {
        return new Response(null, { status: 403 });
    }
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
        },
    });
}
