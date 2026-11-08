# Notes for Strava's API review

Draft material for the review/capacity submission. Written to be pasted into Strava's form and adapted. Nothing here has been submitted. Bracketed items are for you to fill in.

## What the app does

Club Recap is a small, free, volunteer-run tool for a UK running club ([club name], about [N] members). Each Monday it produces a one-page "weekly recap" image and caption for the club's social media: the week's fastest 5K, longest run, most climbing, most distance, most runs and most time on feet, plus the club's total distance for the week and the year.

- **Opt-in.** A runner only appears if they click "Connect with Strava" on the club's page and approve.
- **Club members, or approved guests.** On connecting, and weekly after, the app calls `GET /athlete/clubs` with the runner's *own* token and treats a runner as a member only if they are in the club's Strava club. Someone outside the club can ask to join: they are held as pending (no data fetched) until a club admin approves them as a guest, or the request expires after 14 days.
- **Runs only.** It reads `sport_type` of `Run`, `TrailRun` and `VirtualRun`. Everything else is ignored.
- **No AI.** No Strava data is sent to any AI or machine-learning service. Captions are fixed templates filled with numbers.
- Hosted on free tiers: a Cloudflare Worker and D1 database, and a GitHub Pages site.

## How it uses the API

| Need | Call |
| --- | --- |
| Consent | OAuth authorise with scope `read,activity:read` only (never `activity:read_all`, so private activities are never seen) |
| Tokens | `POST /oauth/token` for the code exchange and for refresh (refreshed within 5 minutes of expiry; the rotated refresh token is always saved) |
| Club membership | `GET /athlete/clubs` with the runner's own token |
| Lifetime milestones | `GET /athletes/{id}/stats`, once per runner per week (only the lifetime run distance is used) |
| New and changed runs | Webhook subscription (`activity` create/update/delete, `athlete` deauthorisation), then `GET /activities/{id}` for that one activity |
| Safety-net catch-up | Hourly, a few runners at a time: `GET /athlete/activities?after=` |
| Disconnect | `POST /oauth/revoke` (HTTP Basic client auth, form body), and handling of the deauthorisation webhook |

Access tokens are sent in the `Authorization: Bearer` header only. The API base URL is configurable so the move to `https://api-v3.strava.com` is a one-line change. The app does not use any club activity, member or admin endpoint.

**Rate limits.** The hourly job reads `X-RateLimit-Limit` / `X-RateLimit-Usage` and stops its batch at 80% of either window, pausing until the window resets. A 429 pauses all syncing for 15 minutes. There is no tight polling; webhooks are the primary path.

## What we store

Per runner: Strava athlete ID, first name, **surname initial only**, access and refresh tokens (AES-GCM encrypted, key held as a Worker secret), granted scope, and when they connected and were last synced.

Per run: activity ID, athlete ID, local start date and time, `sport_type`, distance, moving time, elevation gain, the manual / treadmill / flagged flags (needed to apply the club's rules), the best 5K effort if Strava provides one, and which standard distances (1K, 1 mile, 5K, 10K, half, marathon) Strava ranked as a new personal best on that run.

A club admin can also load a runner's older runs (back to 1 January 2025) for a year-end review, one runner at a time, with a confirmation that the runner has agreed. These are the same fields as above. They are deleted with everything else when the runner disconnects.

Per runner, in addition: a lifetime run-distance baseline (Strava's lifetime run total minus the runs we hold), refreshed weekly, used only for lifetime milestones such as "passed 5,000 km".

**People outside the club who ask to join** (an admin must approve them): until approved we hold only their Strava ID, first name, surname initial and encrypted token. No runs are fetched, nothing is shown anywhere, and a request not approved within 14 days is deleted automatically and the token revoked. Approved guests are exempt from the weekly club-membership check.

**Used but not stored:** the `sex` field Strava returns when a runner connects. It picks the club's "Women's leaders" group automatically; only the resulting group is kept, not the field.

**Not stored:** titles, descriptions, maps or polylines, start locations, heart rate, photos, kudos, comments, anything about other athletes' activities, private activities.

**Kept after a runner disconnects:** only a "hide list" entry (club + Strava athlete ID, no name) if a club admin chose to hide them, so the decision survives a reconnect. See open question 4.

## What leaves the system

- A public JSON feed per club, per week: each connected runner's weekly totals (distance, runs, longest run, average pace of outdoor runs, fastest 5K effort, earliest and latest run start time, climbing, moving time) under **"First L."**, for the week and the four before it, plus an optional group label list (for example the Women's leaders panel). No IDs, no links to profiles. The recap page turns this into two images (leaders lists, and "more from the week" with a club distance trend, an "everyone who ran" list and the achievements banner) that the club posts. An orange banner at the foot of the second image highlights the week's personal bests, lifetime distance milestones crossed, and longest running streak. A separate summary endpoint returns only award podiums and totals.
- An admin page (behind a secret token held by the club) shows each connected runner's name as "First L.", their Strava ID and a link to their profile, so two runners with the same initials can be told apart. Not exposed publicly.

## Notifications to the club owner

Optionally, the app emails the club owner (through Resend) when someone connects: first name, surname initial and a count of connected runners, nothing else. No Strava ID, tokens or activity data is sent. It is off unless the owner configures it.

## Runner control

- "Remove my data" on the connect page: deletes everything and revokes the token at Strava.
- Revoking in Strava's My Apps: the deauthorisation webhook deletes everything.
- Leaving the club's Strava club: detected weekly and everything is deleted (only when Strava successfully reports they are not a member; an error never counts).
- Club admins can hide anyone on request.

## Capacity

We expect about 50 active connected athletes (one club, about 150 members). The app is built for several clubs (one JSON file each, consent per club), but only one club is live. We are asking for 50 places.

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
- [x] Official "Connect with Strava" button and "Powered by Strava" logo, unmodified from the brand kit
- [ ] Brand attribution on the generated image (open question 2)
