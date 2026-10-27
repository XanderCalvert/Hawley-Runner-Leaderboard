/**
 * Lists the Strava clubs you belong to, with their numeric IDs (needed for stravaClubId in the club config).
 *
 *   STRAVA_TOKEN=<"Your Access Token" from strava.com/settings/api> node scripts/find-club-id.mjs
 */
const token = process.env.STRAVA_TOKEN;
if (!token) {
    console.error('Set STRAVA_TOKEN to the access token shown on strava.com/settings/api');
    process.exit(1);
}

const apiBase = process.env.STRAVA_API_BASE ?? 'https://www.strava.com/api/v3';
const response = await fetch(`${apiBase}/athlete/clubs?per_page=200`, {
    headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) {
    console.error(`Strava said ${response.status}: ${await response.text()}`);
    process.exit(1);
}
for (const club of await response.json()) {
    console.log(`${String(club.id).padEnd(12)} ${club.name}  (${club.member_count} members)`);
}
