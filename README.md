# LootDrop

## Environment variables

| Setting                                                                                                                                                             | Requirement or default                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                                                                                          | `development`, `test`, or `production`. Defaults to development.                                                 |
| `DATABASE_URL`, `REDIS_URL`                                                                                                                                         | Required at runtime. Use the pooled PostgreSQL URL for the app.                                                  |
| `DIRECT_URL`                                                                                                                                                        | Required in production. Also required for Prisma migration commands.                                             |
| `WEB_ORIGIN`                                                                                                                                                        | Exact HTTPS browser origin in production. Defaults to port 5173 on localhost in development.                     |
| `API_PORT`, `LOG_LEVEL`, `TRUST_PROXY`                                                                                                                              | Default to `4000`, `info`, and `0`. Set the proxy hop count only on a controlled ingress path.                   |
| `JWT_ACCESS_SECRET`, `JWT_ISSUER`                                                                                                                                   | Signing secret is required. Generate at least 32 random bytes for production. Issuer defaults to `lootdrop-api`. |
| `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAME_SITE`                                                                                                                       | Secure defaults on in production and is required there. SameSite defaults to `lax`.                              |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES`, `AUTH_RATE_LIMIT_MAX`                                                                                                             | Default to `15` and `10`.                                                                                        |
| `CHEAPSHARK_USER_AGENT`, `CHEAPSHARK_MAX_PAGES`, `DEAL_SYNC_INTERVAL_MINUTES`                                                                                       | Optional provider identity, request bound, and interval. Default page bound is 2 and interval is 45 minutes.     |
| `RAWG_API_KEY`, `RAWG_MAX_REQUESTS_PER_RUN`, `RAWG_ENRICH_BATCH_SIZE`, `ENRICH_INTERVAL_MINUTES`                                                                    | RAWG is optional. Budgets default to `30`, `15`, and `60` minutes.                                               |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`                                                                                                                    | Default provider is `log`. Both credentials/settings are required for `resend`.                                  |
| `VITE_API_BASE_URL`                                                                                                                                                 | Optional web build override. Defaults to the same-origin `/api/v1` path.                                         |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `REDIS_PORT`                                                                                  | Local Docker development settings.                                                                               |
| `DEMO_USER_PASSWORD`                                                                                                                                                | Required only when running the demo seed.                                                                        |
| `DIRECT_URL_PHASE4_TEST` / `DATABASE_URL_PHASE4_TEST`, `DIRECT_URL_PHASE5_TEST` / `DATABASE_URL_PHASE5_TEST`, `DIRECT_URL_PHASE6_TEST` / `DATABASE_URL_PHASE6_TEST` | Guarded test endpoints in the ignored root environment file.                                                     |
| `BULLMQ_PREFIX`, `DISABLE_REPEATABLE_SCHEDULES`                                                                                                                     | Scoped by the guards. Normal workers use BullMQ's `bull` prefix and register schedules.                          |
| `PHASE4_TEST_GUARD`, `PHASE5_GUARD_TARGET`, `PHASE5_GUARD_FINGERPRINT`, `PHASE6_TEST_GUARD`, `PHASE6_TEST_FINGERPRINT`                                              | Internal values set by the branch guards.                                                                        |

After building, use `npm run start` for the API and `npm run start:worker`
for the worker. Use `/health` for liveness and `/health/ready` for dependency
readiness.

LootDrop tracks game prices and sends notifications when a saved price rule is met.

## Price alerts

Create alerts from a game page or wishlist. Each alert watches one game and either
a selected store or the cheapest listing in the alert's currency:

- **Price drops below** fires when a matching price is at or below the target.
- **Discount reaches** fires when a matching discount is at or above the target.
- **Any sale starts** fires when a matching listing is marked on sale.
- **New all-time low** fires when the current price is no higher than its historical
  low; at least two price snapshots for that listing and currency are required.

Prices are compared only within the alert currency. An alert can trigger at most
once per 24-hour cooldown, and a still-true condition will not repeatedly notify.
It re-arms after an evaluation finds the condition false. Email is capped at 20
messages per user in a rolling 24-hour period. In-app notifications are created
when an alert fires; email delivery is separate.

Email is disabled by default: `EMAIL_PROVIDER=log` writes one masked log line and
sends nothing. To enable the Resend provider, set these API environment variables:

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY` — your Resend API key
- `EMAIL_FROM` — a verified sender address

With the default `EMAIL_PROVIDER=log`, no mail credentials are required. The API
environment template is [apps/api/.env.example](apps/api/.env.example).

### Safe child-branch testing

Use the isolated Neon child branch `lootdrop / phase-4-test / neondb`, not
production. Put its direct and pooled URLs in the root `.env` as
`DIRECT_URL_PHASE4_TEST` and `DATABASE_URL_PHASE4_TEST`. The guard verifies those
targets, rejects production matches, overrides database variables only for the
child process, forces the log email provider, and uses a unique queue prefix.
The live Phase 4 check calls the sync and evaluator directly; it does not start
a BullMQ worker or register the recurring sync schedule.

From PowerShell, run the real integration check with:

```powershell
node scripts/phase4-test-guard.mjs -- npx tsx apps/api/scripts/phase4-live-check.ts
```

For one explicitly named, store-scoped throwaway `PRICE_BELOW` alert, the
development-only simulator temporarily changes the named listing's price,
evaluates it, sends no real email, and restores the listing price:

```powershell
node scripts/phase4-test-guard.mjs -- npx tsx apps/api/scripts/phase4-simulate-drop.ts --alert <alert-uuid> --price 0.01
```

Replace the alert placeholder with an ID from the child branch and use a price
below both the listing's current price and the alert target. The simulator
refuses production, unguarded execution, non-throwaway users, and ambiguous
alerts or listings.

## Metadata enrichment

LootDrop searches RAWG for catalog games without a RAWG ID. It accepts a single
result whose title matches after normalizing case, punctuation, trademarks and
edition words. An exact match keeps similar games from being assigned the wrong
metadata. The worker preserves existing fields and links. It remembers
unmatched, ambiguous and conflicting games in Redis for seven days.
Enrichment runs on the existing worker at concurrency one, sharing its Redis
queue polling with deal sync.

| API environment variable    | Default | Effect                                                         |
| --------------------------- | ------- | -------------------------------------------------------------- |
| `RAWG_API_KEY`              | Unset   | Enables enrichment. The API and worker still start without it. |
| `RAWG_MAX_REQUESTS_PER_RUN` | 30      | Caps outbound RAWG requests, including retries.                |
| `RAWG_ENRICH_BATCH_SIZE`    | 15      | Caps games examined per run. On-sale games go first.           |
| `ENRICH_INTERVAL_MINUTES`   | 60      | Sets the recurring worker interval within 30 to 240 minutes.   |

Keep the key in the ignored root `.env`. Use `DIRECT_URL_PHASE5_TEST` and
`DATABASE_URL_PHASE5_TEST` for the isolated `lootdrop / phase-5-test / neondb`
child branch. The guard verifies the configured endpoints, gives the subprocess
an isolated queue prefix and disables repeatable schedules.

```powershell
node scripts/phase5-test-guard.mjs --check-only
node scripts/phase5-test-guard.mjs -- npm run enrich:once -- --limit 10
```

To reproduce the full check, build the shared contracts and run the guarded
script. It enriches two batches on the child branch and verifies that the second
batch leaves the previously enriched rows and their link counts intact.

```powershell
npm.cmd run build --workspace=@dealhunter/contracts
node scripts/phase5-test-guard.mjs -- node scripts/phase5-live-check.mjs
```

For a browser check, start the guarded API in one PowerShell window and run
`npm.cmd run dev:web` in another. Open [LootDrop](http://localhost:5173). Add
`--without-key` before the guard's `--` to exercise startup with enrichment
disabled. Previously saved metadata remains visible when enrichment is disabled.

```powershell
npm.cmd run build --workspace=@dealhunter/contracts
node scripts/phase5-test-guard.mjs -- node --import tsx apps/api/src/server.ts
```

On a catalog awaiting enrichment, games without cover URLs show placeholders
and empty filters are hidden. After enrichment, select genre and platform
filters, refresh to confirm they stay selected, and open a game to inspect its
cover, ratings, release date, taxonomy and description.

RAWG requires credit and an active link on each page that uses its data or
images. LootDrop links to RAWG in the site footer and on game detail pages.
[RAWG API terms](https://rawg.io/tos_api)

## Currency display

Use the header's **Currency** selector to display prices in USD, INR, or EUR.
The app marks converted prices with **≈** and keeps the original amount in the
price's tooltip. It uses ECB reference rates from the keyless Frankfurter API.
Stores may charge different regional prices. Historical graphs apply the latest
available reference rate to every point. [Frankfurter terms](https://frankfurter.dev/license/)

Conversion happens in the browser. Stored prices and history, filters, sorting,
alert targets, and emails use the original listing currency. Dashboard price
filter inputs use USD for the tracked catalog and show that unit when you
select INR or EUR. Alert target inputs show their listing currency.

The public `GET /api/v1/rates` endpoint fetches rates on demand. Redis keeps a
fresh copy for 24 hours and a last-known copy for seven days. The API serves
last-known rates during provider failures and returns HTTP 503 if no usable
rates remain. The web app uses original prices when rates are unavailable.
The rate timestamp records the provider's reference date in UTC.

Accounts load their saved preference from `GET /api/v1/auth/me` and save through
`PATCH /api/v1/me/preferences`. Guests use `lootdrop.currency` in local storage.
Signing out restores the guest choice or USD.

### Currency browser and live checks

Start the guarded child-branch API in one PowerShell window.

```powershell
npm.cmd run build --workspace=@dealhunter/contracts
node scripts/phase5-test-guard.mjs --without-key -- node --import tsx apps/api/src/server.ts
```

In another window, run `npm.cmd run dev:web` and open
[LootDrop](http://localhost:5173).

1. Switch USD, INR, and EUR on the dashboard, then check a game page, its price
   chart, the wishlist, and the alerts page. Hover a converted price to see the
   original amount. Check that price inputs still show their original units.
2. As a guest, refresh and confirm the choice persists. Sign in with a test
   account, save a different currency, and refresh again. Sign out and confirm
   the guest choice returns.
3. Stop the API and reload. The site shows its existing loading errors for
   unavailable deal data. If prices are already loaded and the rates request
   fails, they display in their original currency with an exchange-rate notice.

To run the HTTP and database checks with two automatically cleaned-up
throwaway accounts, use the guarded script from the repository root.

```powershell
node scripts/phase5-test-guard.mjs --without-key -- node --import tsx scripts/phase5b-live-check.mjs
```
