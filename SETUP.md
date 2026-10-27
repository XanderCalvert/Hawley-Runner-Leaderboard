# SETUP: deploying the hosted Strava version

A checklist for you to work through. Nothing here has been run for you: no Cloudflare resources exist, no webhook is registered, and no real secrets are in the repo. Commands are for PowerShell on Windows; run them from the repo root (`club-recap/`) unless a step says otherwise.

Tick as you go. Do **Part A** (local, your own Strava account) before **Part B** (live).

**Before you start:** Node 22.13+, a free Cloudflare account, a GitHub account, and the Strava account that will own the app. The quick recap (`Weekly recap.bat`, the paste page) is independent of all of this and keeps working throughout.

---

## Part A: Test locally first

### A1. Install and run the tests

- [ ] `npm install`
- [ ] `npm test` (about 60 tests) and `npm run typecheck`. Both should be clean.

### A2. Fake Strava (no Strava account needed)

- [ ] `Copy-Item apps/worker/.dev.vars.example apps/worker/.dev.vars`
- [ ] In `.dev.vars`, uncomment the two `STRAVA_OAUTH_BASE` / `STRAVA_API_BASE` lines (they point at the mock). Fill the other values with anything; `node scripts/make-secret.mjs` makes good random ones.
- [ ] `npm run db:migrate:local` (creates a local D1 under `apps/worker/.wrangler/`, gitignored)
- [ ] Terminal 1: `npm run mock:strava` (add `$env:MOCK_ATHLETE_LIMIT=3` first to try the "leaderboard is full" path)
- [ ] Terminal 2: `npm run dev:worker` (Worker on <http://localhost:8787>)
- [ ] Open `http://localhost:8787/auth/start?club=hawley-runners`. Each visit signs in as the next fake runner; every 10th is not a club member.
- [ ] Check `http://localhost:8787/api/clubs/hawley-runners/summary?week=<a Monday>`

### A3. Your own Strava account, locally

A new Strava app can connect **one athlete** (you), which is exactly right for this.

1. [ ] Create the app at <https://www.strava.com/settings/api>. Set **Authorization Callback Domain** to `localhost`.
2. [ ] Put the app's **Client ID** in `apps/worker/wrangler.jsonc` (`STRAVA_CLIENT_ID`) and its **Client Secret** in `.dev.vars` (`STRAVA_CLIENT_SECRET`). Remove or re-comment the two mock `*_BASE` lines.
3. [ ] Find your club's numeric ID. Strava's page shows "Your Access Token"; use it once:
   ```powershell
   $env:STRAVA_TOKEN = "<access token from the API settings page>"; node scripts/find-club-id.mjs
   ```
   Put the number in `config/clubs/hawley-runners.json` as `stravaClubId` (it is `0` until you do; nobody can connect without it).
4. [ ] `npm run dev:worker`, then open `http://localhost:8787/auth/start?club=hawley-runners` (use `localhost`, not `127.0.0.1`, so it matches the callback domain).
5. [ ] After approving, the redirect to `connected.html` will fail locally because `WEB_BASE_URL` points at GitHub Pages. That is fine: check `http://localhost:8787/api/clubs/hawley-runners/summary?week=<Monday>` instead.
6. [ ] To exercise the hourly catch-up, run the Worker with `npx wrangler dev --test-scheduled` (from `apps/worker/`) and open `http://localhost:8787/__scheduled`.

Webhooks can't reach localhost without a tunnel, so Part A relies on the backfill and the hourly sync. Webhooks are tested live in Part B.

---

## Part B: Going live

### B1. Strava app

- [ ] In the app settings, set **Authorization Callback Domain** to your Worker's host, e.g. `club-recap.<your-subdomain>.workers.dev` (no `https://`, no path). You will know the exact host after B4; you can come back and set it then. For now `localhost` is fine.
- [ ] Capacity: the app starts at 1 athlete and self-upgrades to 10 (follow the upgrade prompt on the app's settings page). Beyond 10 needs Strava's review: see [docs/strava-review-notes.md](docs/strava-review-notes.md). Until then the 11th person sees "The leaderboard is full for now. We've asked Strava for more places."
- [ ] Download Strava's official assets from <https://developers.strava.com/guidelines/> and drop them into `apps/web/assets/img/strava/` **unmodified**. See the README in that folder for the two file names the pages expect.

### B2. Cloudflare: database

```powershell
cd apps/worker
npx wrangler login
npx wrangler d1 create club-recap
```

- [ ] Copy the printed `database_id` into `apps/worker/wrangler.jsonc` (`d1_databases[0].database_id`).
- [ ] `npx wrangler d1 migrations apply club-recap --remote` (applies `0001` and `0002`).

### B3. Cloudflare: variables and secrets

Edit the `vars` block in `apps/worker/wrangler.jsonc`:

- [ ] `STRAVA_CLIENT_ID`: from your Strava app page.
- [ ] `STRAVA_API_BASE`: leave as `https://www.strava.com/api/v3`. (From 4 Jan 2027 you can change this one line to `https://api-v3.strava.com` and redeploy; it is required by 1 Jun 2027. The scripts in `scripts/` honour the same `STRAVA_API_BASE` environment variable.)
- [ ] `WEB_BASE_URL`: your Pages URL, no trailing slash, e.g. `https://<you>.github.io/<repo>`. Pick the repo name now so you know this before pushing.
- [ ] `ALLOWED_ORIGINS`: `https://<you>.github.io` (add `,http://localhost:5173` only if you want to test the site locally against the live Worker).

Secrets (each command prompts you to paste the value):

| Secret | Value | Notes |
| --- | --- | --- |
| `STRAVA_CLIENT_SECRET` | From the Strava app page | |
| `STRAVA_VERIFY_TOKEN` | Any random string (`node scripts/make-secret.mjs`) | Reused when you create the webhook in B5 |
| `APP_SECRET` | `node scripts/make-secret.mjs` | Signs OAuth state **and** is the AES-GCM key source for stored tokens. **Never change it once people have connected**: every stored token becomes unreadable and everyone must reconnect. |
| `ADMIN_TOKEN` | `node scripts/make-secret.mjs` (24+ chars) | The password for `admin.html` |

- [ ] `npx wrangler secret put STRAVA_CLIENT_SECRET`
- [ ] `npx wrangler secret put STRAVA_VERIFY_TOKEN`
- [ ] `npx wrangler secret put APP_SECRET`
- [ ] `npx wrangler secret put ADMIN_TOKEN`

Keep copies of `APP_SECRET` and `ADMIN_TOKEN` in your password manager; `wrangler` can't show them again.

### B4. Deploy the Worker

- [ ] Make sure `stravaClubId` is set (A3 step 3).
- [ ] From the repo root: `npm run deploy:worker`
- [ ] Note the URL it prints (`https://club-recap.<your-subdomain>.workers.dev`). Open it: you should see `{"name":"club-recap","ok":true}`.
- [ ] Go back to the Strava app settings and set **Authorization Callback Domain** to that host (B1).
- [ ] The Cron Trigger (`17 * * * *`, hourly) is created by the deploy. Confirm under Workers → club-recap → Triggers.

### B5. Webhook subscription (one per Strava app)

Strava calls your Worker to validate the subscription, so the Worker must already be deployed with the same `STRAVA_VERIFY_TOKEN`.

```powershell
$env:STRAVA_CLIENT_ID = "<id>"; $env:STRAVA_CLIENT_SECRET = "<secret>"; $env:STRAVA_VERIFY_TOKEN = "<same verify token>"
npm run webhook -- create https://club-recap.<your-subdomain>.workers.dev/webhook
```

- [ ] A response containing an `id` means it worked. Put that `id` in `wrangler.jsonc` `vars` as `"STRAVA_SUBSCRIPTION_ID": "<id>"` and run `npm run deploy:worker` again. The Worker then ignores events from any other subscription.
- [ ] `npm run webhook -- view` shows the subscription (use it to check; `delete <id>` removes it).

### B6. GitHub and Pages

You are adding the remote yourself (none is set yet):

- [ ] Create the GitHub repo (the same name you used in `WEB_BASE_URL`). Private is fine for the repo; Pages will still publish the site.
- [ ] `git remote add origin https://github.com/<you>/<repo>.git`
- [ ] Set `apiBase` in `apps/web/assets/js/config.js` to your Worker URL (no trailing slash), then commit: `git commit -am "Chore: point the site at the live Worker"`.
- [ ] Check nothing sensitive is staged: no `.dev.vars`, no files from `F:\Hawley Runners\recaps\`, no CSVs of runner names. (`.dev.vars` is gitignored; the recaps archive is outside the repo on purpose.)
- [ ] `git push -u origin main`
- [ ] Repo → **Settings → Pages → Source: GitHub Actions**. The `pages.yml` workflow publishes `apps/web` on every push to `main`. `ci.yml` runs typecheck and tests.
- [ ] Open `https://<you>.github.io/<repo>/?club=hawley-runners`. It should show the connect page with the Strava button.
- [ ] If your Pages URL differs from what you put in `WEB_BASE_URL` / `ALLOWED_ORIGINS`, fix them in `wrangler.jsonc` and redeploy.

---

## Part C: Start-to-finish test

Use your own Strava account (the only athlete allowed at capacity 1).

1. [ ] **Connect.** Open the connect page, click **Connect with Strava**, approve. You should land on "You're in". Ask a friend who is *not* in the Strava club to try too: they should get "Join the club on Strava first", and nothing is stored.
2. [ ] **Admin sees you.** Open `admin.html` (on your Pages site), paste `ADMIN_TOKEN`. You should be listed with your Strava ID (a link to your profile) and your runs this year.
3. [ ] **Log a run.** Record or upload a real GPS run on Strava (a *manual* entry is ignored by the Hawley rules). Make sure it is visible to "Followers" or "Everyone", not "Only you".
4. [ ] **Webhook.** Run `npx wrangler tail` (from `apps/worker/`) and watch the event arrive within seconds. In `admin.html` the stored run count goes up by one.
5. [ ] **Card.** Open `recap.html?club=hawley-runners&week=<this week's Monday>` (the default is the last *completed* week). Your run is in the totals and, if it qualifies, an award. The caption underneath is built from the same data.
6. [ ] **Edit and delete.** Delete the run on Strava; the stored count drops by one.
7. [ ] **Hide.** In `admin.html` click **Hide from recap**: you vanish from the card but stay listed.
8. [ ] **Disconnect.** On the connect page click **Remove my data** and approve again. You should see "You've been removed".
9. [ ] **Data gone.** Confirm:
   ```powershell
   cd apps/worker
   npx wrangler d1 execute club-recap --remote --command "SELECT (SELECT COUNT(*) FROM athletes) a, (SELECT COUNT(*) FROM memberships) m, (SELECT COUNT(*) FROM activities) r, (SELECT COUNT(*) FROM hidden) h"
   ```
   `a`, `m` and `r` must be `0`. `h` is `1` only because you hid yourself in step 7; that is the one thing deliberately kept (club + Strava ID). Un-hide yourself in `admin.html` first (before disconnecting) if you want a fully empty result.
10. [ ] **Revoked at Strava.** On Strava → Settings → My Apps, check whether the app is still listed. The docs don't say whether `/oauth/revoke` also removes it from that page; please note what you see (it is an open question in the review notes).
11. [ ] **Webhook deauthorisation path.** Connect again, then remove the app from Strava → Settings → My Apps instead. Within seconds the D1 query above should return zeros again (Strava sends the deauthorisation event).

---

## Day-to-day

- **Weekly:** open `recap.html`, **Download PNG**, **Copy caption**, post.
- **Hide someone:** `admin.html`. The hide holds even if they disconnect and reconnect.
- **Strava rate limits:** nothing to do. The hourly sync reads Strava's rate-limit headers, stops at 80% of a window and resumes after it resets. `admin.html` shows when syncing is paused.
- **Leavers:** weekly, each runner's own token asks Strava (`GET /athlete/clubs`) whether they are still in the club. If Strava *successfully* says no, they are deleted and their token is revoked. If the call fails, nothing happens and it is retried next sync.
- **New club:** see "White-labelling another club" in the README. One Strava app serves every club, so capacity is shared.

## Known unknowns

- **Athlete-limit error wording.** The Worker treats a 400/403 from the token exchange whose body mentions "limit" as the athlete cap (`isAthleteLimit` in `apps/worker/src/strava.ts`). I haven't seen Strava's real response. The first time the cap is hit, check `npx wrangler tail`; if the message differs, adjust that one function and its test.
- **Webhook script and the client secret.** `scripts/strava-webhook.mjs` sends `client_id`/`client_secret` as parameters, as Strava's push-subscription API expects. That is app credentials, not a runner's access token (those only ever go in the `Authorization` header), but it is worth a glance at Strava's current docs if you are being strict.
- **Node on CI.** The tests use `node:sqlite` (Node 22.13+). They pass locally; the first GitHub Actions run will confirm CI's Node 22 is new enough.
