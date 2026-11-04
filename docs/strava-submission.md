# Strava API Program submission (for when we reach 10 athletes)

Form: https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8

**Do not submit until the app dashboard (strava.com/settings/api) shows 10 of 10 athletes connected.** Strava denies requests from apps that haven't reached the Standard-tier limit. Expect the capacity granted to be lower than asked for.

## Answers

| Field | Answer |
| --- | --- |
| First / last name | (yours) |
| Email | (yours; replies come from developers@strava.com, so check spam) |
| Company Name | Hawley Runners (volunteer running club, not a company) |
| API Application Name | Hawley Runner Leaderboard |
| Strava Client ID | 131632 |
| Additional Apps | None |
| Currently Authenticated Users | 10 |
| Intended Users | 50 |
| Support URL | https://xandercalvert.github.io/Hawley-Runner-Leaderboard/ |
| TOS / API Policy / Brand Guidelines boxes | Tick after reading each document |

## Application Description (paste)

A free, volunteer-run weekly recap for Hawley Runners, a UK running club (Strava club 298695, about 150 members). Each Monday it produces two images and a caption for the club's Facebook group: leaders for distance, longest run, pace, climbing and time on feet, plus a club distance trend, an "everyone who ran" list and an achievements banner (personal bests, lifetime milestones, streaks). We are at the Standard-tier limit of 10 athletes and have more members waiting to connect; we are asking for 50.

- Opt-in: runners connect individually with "Connect with Strava" and can remove their data at any time on our page. We call POST /oauth/revoke and also handle the deauthorisation webhook.
- Scope: read,activity:read only. Never activity:read_all, so private activities are never seen.
- Membership: checked per runner with GET /athlete/clubs using their own token, on connect and weekly after. No club endpoints are used. People outside the club may ask to join but are held with no data fetched until an admin approves them.
- Sync: webhooks first (subscription 382736), with an hourly catch-up that stops at 80% of the rate limits and backs off on 429s.
- Data: only runs (Run, TrailRun, VirtualRun) as distance, time, elevation and personal-best flags. No titles, maps, locations, heart rate or photos. Display names are first name plus surname initial only. No Strava data is sent to any AI or ML service.
- Branding: official "Connect with Strava" button and "Powered by Strava" logo.

Runners' first name and surname initial plus weekly results are shown in a public image posted to the club's Facebook group. Please tell us if this is not permitted.

## App Images (must show every place Strava data appears)

Use sample data (`recap.html?sample=1`) so no real names are shown.

1. Recap page, card 1 and card 2
2. Connect page (button and "Powered by Strava" logo)
3. Connected page and the "remove my data" option
4. Admin page, names blurred (it shows names and Strava IDs)

Fuller data-handling notes: [strava-review-notes.md](strava-review-notes.md).
