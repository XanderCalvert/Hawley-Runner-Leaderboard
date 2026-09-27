import type { Env } from '../env.ts';
import { error, json } from '../http.ts';
import { handleWebhookEvent } from '../sync.ts';
import type { StravaWebhookEvent } from '../sync.ts';

/** GET /webhook — Strava's one-off subscription validation handshake. */
export function verifyWebhook(request: Request, env: Env): Response {
    const params = new URL(request.url).searchParams;
    if (params.get('hub.mode') !== 'subscribe' || params.get('hub.verify_token') !== env.STRAVA_VERIFY_TOKEN) {
        return error(403, 'Verification failed');
    }
    return json({ 'hub.challenge': params.get('hub.challenge') });
}

/** POST /webhook — must answer within 2 seconds, so the real work happens after responding. */
export async function receiveWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const event = (await request.json()) as StravaWebhookEvent;
    if (env.STRAVA_SUBSCRIPTION_ID && String(event.subscription_id) !== env.STRAVA_SUBSCRIPTION_ID) {
        return error(403, 'Unknown subscription');
    }
    ctx.waitUntil(handleWebhookEvent(env, event));
    return json({ ok: true });
}
