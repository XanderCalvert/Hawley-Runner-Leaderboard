/**
 * Manage the Strava webhook subscription (one per Strava app).
 *
 *   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... node scripts/strava-webhook.mjs view
 *   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_VERIFY_TOKEN=... \
 *       node scripts/strava-webhook.mjs create https://club-recap.YOUR-SUBDOMAIN.workers.dev/webhook
 *   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... node scripts/strava-webhook.mjs delete <subscription-id>
 *
 * The Worker must already be deployed with the same STRAVA_VERIFY_TOKEN, because Strava calls it
 * to validate the subscription before confirming.
 */
const API = 'https://www.strava.com/api/v3/push_subscriptions';
const { STRAVA_CLIENT_ID: clientId, STRAVA_CLIENT_SECRET: clientSecret, STRAVA_VERIFY_TOKEN: verifyToken } = process.env;
const [command, arg] = process.argv.slice(2);

if (!clientId || !clientSecret) {
    console.error('Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET first.');
    process.exit(1);
}

async function main() {
    switch (command) {
        case 'view': {
            const response = await fetch(`${API}?client_id=${clientId}&client_secret=${clientSecret}`);
            console.log(response.status, await response.text());
            break;
        }
        case 'create': {
            if (!arg || !verifyToken) {
                console.error('Usage: create <callback-url> (with STRAVA_VERIFY_TOKEN set)');
                process.exit(1);
            }
            const body = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                callback_url: arg,
                verify_token: verifyToken,
            });
            const response = await fetch(API, { method: 'POST', body });
            console.log(response.status, await response.text());
            console.log('Put the returned id into wrangler.jsonc vars as STRAVA_SUBSCRIPTION_ID, then redeploy.');
            break;
        }
        case 'delete': {
            if (!arg) {
                console.error('Usage: delete <subscription-id>');
                process.exit(1);
            }
            const response = await fetch(`${API}/${arg}?client_id=${clientId}&client_secret=${clientSecret}`, { method: 'DELETE' });
            console.log(response.status, await response.text());
            break;
        }
        default:
            console.error('Commands: view | create <callback-url> | delete <id>');
            process.exit(1);
    }
}

main();
