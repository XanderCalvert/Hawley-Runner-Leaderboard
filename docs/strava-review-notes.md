# Notes for Strava's API review

Draft material for the review/capacity submission. Written to be pasted into Strava's form and adapted. Nothing here has been submitted. Bracketed items are for you to fill in.

## What the app does

Club Recap is a small, free, volunteer-run tool for a UK running club ([club name], about [N] members). Each Monday it produces a one-page "weekly recap" image and caption for the club's social media: the week's fastest 5K, longest run, most climbing, most distance, most runs and most time on feet, plus the club's total distance for the week and the year.

- **Opt-in.** A runner only appears if they click "Connect with Strava" on the club's page and approve.
- **Club members only.** On connecting, and weekly after, the app calls `GET /athlete/clubs` with the runner's *own* token and only keeps them if they are a member of the club's Strava club. Not a member: nothing is stored and their token is revoked.
- **Runs only.** It reads `sport_type` of `Run`, `TrailRun` and `VirtualRun`. Everything else is ignored.
- **No AI.** No Strava data is sent to any AI or machine-learning service. Captions are fixed templates filled with numbers.
- Hosted on free tiers: a Cloudflare Worker and D1 database, and a GitHub Pages site.

## How it uses the API

| Need | Call |
| --- | --- |
| Consent | OAuth authorise with scope `read,activity:read` only (never `activity:read_all`, so private activities are never seen) |
| Tokens | `POST /oauth/token` for the code exchange and for refresh (refreshed within 5 minutes of expiry; the rotated refresh token is always saved) |
| Club membership | `GET /athlete/clubs` with the runner's own token |
| New and changed runs | Webhook subscription (`activity` create/update/delete, `athlete` deauthorisation), then `GET /activities/{id}` for that one activity |
| Safety-net catch-up | Hourly, a few runners at a time: `GET /athlete/activities?after=` |
| Disconnect | `POST /oauth/revoke` (HTTP Basic client auth, form body), and handling of the deauthorisation webhook |

Access tokens are sent in the `Authorization: Bearer` header only. The API base URL is configurable so the move to `https://api-v3.strava.com` is a one-line change. The app does not use any club activity, member or admin endpoint.

**Rate limits.** The hourly job reads `X-RateLimit-Limit` / `X-RateLimit-Usage` and stops its batch at 80% of either window, pausing until the window resets. A 429 pauses all syncing for 15 minutes. There is no tight polling; webhooks are the primary path.

## What we store

Per runner: Strava athlete ID, first name, **surname initial only**, access and refresh tokens (AES-GCM encrypted, key held as a Worker secret), granted scope, and when they connected and were last synced.

Per run: activity ID, athlete ID, local start date and time, `sport_type`, distance, moving time, elevation gain, the manual / treadmill / flagged flags (needed to apply the club's rules), and the best 5K effort if Strava provides one.

**Not stored:** titles, descriptions, maps or polylines, start locations, heart rate, photos, kudos, comments, anything about other athletes' activities, private activities.

**Kept after a runner disconnects:** only a "hide list" entry (club + Strava athlete ID, no name) if a club admin chose to hide them, so the decision survives a reconnect. See open question 4.

## What leaves the system

- A public JSON summary per club, per week: group totals, and for each award the top three as **"First L."** with a value (for example "Sarah K., 19:27"). No IDs, no links to profiles. The same content is rendered into the image the club posts.
- An admin page (behind a secret token held by the club) shows each connected runner's name as "First L.", their Strava ID and a link to their profile, so two runners with the same initials can be told apart. Not exposed publicly.

## Runner control

- "Remove my data" on the connect page: deletes everything and revokes the token at Strava.
- Revoking in Strava's My Apps: the deauthorisation webhook deletes everything.
- Leaving the club's Strava club: detected weekly and everything is deleted (only when Strava successfully reports they are not a member; an error never counts).
- Club admins can hide anyone on request.

## Capacity

We expect about [N] connected athletes (one club, [N] members). The app is built for several clubs (one JSON file each, consent per club), but only one club is live. We are asking for [N] places.

## Open questions for Strava

1. **Showing members' data to each other (the main one).** The recap shows each connected runner's first name, surname initial and results to everyone who sees the club's posted image or the public summary: not only to the other members, and not only to people who follow them on Strava. Each runner opted in to exactly this, per club, and can leave any time. Is that acceptable under the API Agreement, or must display be limited to, for example, the authenticated athlete's own data, or to people who are the runner's followers or fellow club members? If the latter, we would put the summary behind a members-only sign-in and stop posting names publicly.
2. **Posting the image outside Strava.** The image is posted to the club's Facebook group. Does that need any extra attribution beyond the "Powered by Strava" logo on our site? The card currently carries the text "Data from Strava" but not the logo.
3. **Revoke and "My Apps".** The docs for `POST /oauth/revoke` don't say whether it also removes the app from the athlete's "My Apps" page. After a "Remove my data" the app may still appear there. Is that expected, and is there an endpoint that removes it?
4. **Hide-list retention.** We keep a club + athlete ID pair after disconnect for athletes an admin hid, with no name or activity data. Is retaining an athlete ID for that purpose acceptable, or must even that be deleted on disconnect (in which case a hidden runner who reconnects would reappear until an admin hides them again)?
5. **Athlete-limit error.** What exactly does the token exchange return when the app is at its athlete limit? We handle it by showing "The leaderboard is full for now. We've asked Strava for more places." but match on the response body ("limit"), which may not be what Strava sends.
6. **Webhook subscription credentials.** The push-subscription endpoints take `client_id` and `client_secret` as parameters. Confirmed that's still the intended method?

## Policy checklist

- [x] No AI/ML use of API data
- [x] Scope limited to `read,activity:read`
- [x] No club endpoints (removed 1 Sep 2026)
- [x] Membership verified per runner via `GET /athlete/clubs`
- [x] Disconnect via `POST /oauth/revoke`, plus the deauthorisation webhook
- [x] Tokens only in the `Authorization` header; refresh and rotated refresh token handled
- [x] Rate-limit headers respected, backoff on 429, no tight polling
- [x] Configurable API base (`api-v3.strava.com` ready)
- [ ] Official "Connect with Strava" button and "Powered by Strava" logo: placeholders are wired in; assets need downloading from developers.strava.com/guidelines (see `apps/web/assets/img/strava/README.md`)
- [ ] Brand attribution on the generated image (open question 2)
