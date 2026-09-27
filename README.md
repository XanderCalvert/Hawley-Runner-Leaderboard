# Club Recap

Weekly Strava recap infographics for running clubs. Built for **Hawley Runners**, designed so any club can be added with one config file.

Runners opt in by connecting their Strava once. Every Monday you open the recap page, pick the week, download a 1080 × 1350 PNG and copy the ready-made caption into Facebook or the Strava club.

The recap shows:

- **This week's awards (top 3):** fastest 5K (a true best-effort split, not average pace), longest run, most climbing, most distance, most runs.
- **Group totals:** distance, runs, runners and climbing, compared with last week.
- **Year to date:** distance, runs, climbing and hours, with a progress bar towards the club's goal.
- **Milestones:** anyone who passed 100 / 250 / 500 / 1,000 km (and so on) for the year that week.

It costs nothing to run: GitHub Pages, Cloudflare's free Workers tier and the free Strava API.

<img src="docs/recap-preview.png" alt="Example weekly recap made from sample data" width="432">

---

## How it fits together

```
 Runner ── "Connect with Strava" ──▶  Cloudflare Worker  ◀── webhooks ── Strava
                                     │  OAuth + club check
 GitHub Pages (static)               │  D1 database (minimal run data)
   index.html      join / leave      │  hourly catch-up sync
   recap.html      infographic ◀─────┤  GET /api/clubs/:slug/summary
   admin.html      opt-out list ◀────┘  /admin/* (token protected)
```

| Folder | What it is |
|---|---|
| `config/clubs/` | One JSON file per club: Strava club ID, rules, awards, goal, branding. **This is the white-label layer.** |
| `packages/core/` | The stats engine: eligibility rules, weekly awards, totals, YTD, milestones. Pure TypeScript, unit tested. |
| `apps/worker/` | Cloudflare Worker: Strava OAuth, membership check, webhooks, hourly sync, public summary API, admin API. |
| `apps/web/` | The static site for GitHub Pages. No build step. |
| `scripts/` | Sample data generator, mock Strava server, webhook and secret helpers. |

### Rules that make it fair

- **Opt-in only:** nobody appears unless they connected via the club's link.
- **Club members only:** membership of the club's Strava group is checked on connect and re-checked weekly. Leavers drop off automatically.
- **Admin blacklist:** hide anyone from the recap without disconnecting them (`admin.html`). A hide survives the runner reconnecting.
- **What counts:** only `Run` and `TrailRun` by default (configurable). Manual entries, flagged activities, runs under 1 km and anything faster than 2:30/km (usually a bike ride saved as a run) are ignored.
- **Fastest 5K** uses Strava's best-effort split from GPS runs, so a quick 5K inside a 10K counts.
- **Ties** share a place (`=1`). If more people tie than fit on the podium, the card says "+N more tied".
- **Weeks** run Monday to Sunday on the runner's local date.

### Privacy by design

- Stored per run: sport type, local start time, distance, moving time, climbing, flags and best 5K/10K. No titles, maps, locations, heart rate or photos.
- Strava tokens are AES-GCM encrypted at rest.
- Only "First L." ever leaves the Worker publicly.
- If a runner revokes access in Strava, or uses "Remove my data" on the join page, everything about them is deleted immediately (via Strava's deauthorisation webhook).

---

## Try it locally (no Strava needed)

Requires Node 22.6 or newer.

```bash
npm install
npm test                 # stats engine tests
npm run sample           # writes apps/web/sample/hawley-runners.json from fake runners
npm run dev:web          # http://localhost:5173/recap.html
```

With `apiBase` empty in `apps/web/assets/js/config.js`, the site runs on the sample file. That's the quickest way to tweak the design (`apps/web/assets/css/card.css`).

### Full stack locally, with a fake Strava

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# add STRAVA_BASE_URL=http://localhost:8788 to .dev.vars
npm run db:migrate:local
npm run mock:strava      # terminal 1: fake Strava on :8788
npm run dev:worker       # terminal 2: Worker on :8787
npm run dev:web          # terminal 3: site on :5173 (set apiBase to http://localhost:8787)
```

Each visit to `http://localhost:8787/auth/start?club=hawley-runners` signs in as the next fake runner. Every 10th one isn't a club member, to test the rejection path.

---

## Going live

### 1. Strava API application

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and create an app.
   - *Authorization Callback Domain*: your Worker's domain, e.g. `club-recap.<your-subdomain>.workers.dev`.
2. Find your club's numeric ID:
   ```bash
   STRAVA_TOKEN=<"Your Access Token" from that page> node scripts/find-club-id.mjs
   ```
   Put it in `config/clubs/hawley-runners.json` as `stravaClubId`.
3. **Athlete capacity:** a new Strava app can only connect its owner (you). To let club members connect, submit the app for review through Strava's developer programme. Explain the opt-in, members-only, data-minimised design above. It's free but takes a little while, so do it early.
4. Before submitting, swap the plain "Connect with Strava" button in `index.html` for Strava's official button artwork, and add the "Powered by Strava" logo, per [Strava's brand guidelines](https://developers.strava.com/guidelines/). Also read the current [API Agreement](https://www.strava.com/legal/api), especially the parts on showing one athlete's data to others.

### 2. Cloudflare Worker and database

```bash
cd apps/worker
npx wrangler login
npx wrangler d1 create club-recap          # copy the database_id into wrangler.jsonc
npx wrangler d1 migrations apply club-recap --remote

node ../../scripts/make-secret.mjs          # run 3 times for the three random values below
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_VERIFY_TOKEN
npx wrangler secret put APP_SECRET
npx wrangler secret put ADMIN_TOKEN
```

Edit `wrangler.jsonc` vars:

- `STRAVA_CLIENT_ID`
- `WEB_BASE_URL`, e.g. `https://<you>.github.io/club-recap`
- `ALLOWED_ORIGINS`, e.g. `https://<you>.github.io`

Then run `npx wrangler deploy`.

### 3. Strava webhook (new and deleted runs arrive within seconds)

```bash
STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_VERIFY_TOKEN=... \
    npm run webhook -- create https://club-recap.<your-subdomain>.workers.dev/webhook
```

Put the returned `id` into `wrangler.jsonc` as `STRAVA_SUBSCRIPTION_ID` and redeploy. This makes the Worker ignore anything not from your subscription. The hourly sync still catches anything a webhook misses.

### 4. GitHub Pages

1. Create a GitHub repo and push this folder.
2. Set `apiBase` in `apps/web/assets/js/config.js` to your Worker URL.
3. In the repo, go to **Settings → Pages → Source: GitHub Actions**. The `pages.yml` workflow publishes `apps/web` on every push to `main`.
4. Share `https://<you>.github.io/club-recap/?club=hawley-runners` in the Facebook and Strava groups as the join link.

### Weekly routine

On Monday, open `recap.html`. It defaults to the last completed week.

1. Click **Download PNG**.
2. **Copy caption**.
3. Post it.

Late uploads are included automatically if you regenerate later.

---

## White-labelling another club

1. Copy `config/clubs/hawley-runners.json` to `config/clubs/<new-slug>.json` and change:
   - `slug`, `name` and `stravaClubId`
   - `branding` colours, `logo`, `hashtag` and `footer`
   - `awards` (any of `best5k`, `best10k`, `longestRun`, `distanceTotal`, `elevationTotal`, `runCount`, `movingTimeTotal`)
   - `ytdGoalKm` and `rules`
2. Register it in `config/clubs/index.ts`.
3. Deploy the Worker. Their join link is `…/?club=<new-slug>` and their recap is `…/recap.html?club=<new-slug>`.

Consent is per club: a runner in two clubs connects once for each and can be hidden separately in each. One Strava app serves every club, so when you ask Strava for more athlete capacity, count all clubs.

Ideas for later:

- Square and 9:16 story formats
- Club records
- "Most improved"
- A per-club admin token
- A custom domain per club

---

## Free-tier budget (roughly, for 200 connected runners)

| | Usage | Free limit |
|---|---|---|
| Worker requests | a few hundred a day | 100,000 a day |
| Strava API reads | ~150–300 a day | 1,000 a day (100 per 15 min) |
| Outbound calls per Worker run | capped at 45 in code | 50 |
| D1 storage | a few MB a year | 5 GB |

If Strava ever returns "rate limited", the Worker pauses syncing for 15 minutes and resumes by itself.
