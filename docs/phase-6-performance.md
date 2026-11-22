# Phase 6 performance

Vite 6.4.5 lowered the initial JavaScript chunk from 743.83 kB (213.60 kB gzip)
to 320.49 kB (97.45 kB gzip), a 57% reduction before gzip. The 404.16 kB game
detail chunk includes Recharts and loads only on game detail routes. The
optimized build had zero chunks above 500 kB. Existing cover images declare
dimensions, load lazily and have a fallback. The deals API paginates listings.

## Guarded Neon baseline

Run from the repository root after building the shared contracts.

```powershell
node scripts/phase6-test-guard.mjs -- node --import tsx scripts/phase6-performance.mjs
```

The script checks `lootdrop / phase-6-test / neondb`. It runs representative
read-only SQL plans and warms each endpoint before ten requests at concurrency
two. The p95 in this small sample is the slowest request. Times are milliseconds.

| Path or query   | SQL execution | HTTP p50 | HTTP p95 |
| --------------- | ------------: | -------: | -------: |
| Readiness       |             — |    99.90 |   103.65 |
| Filtered deals  |         1.659 |   267.48 |   408.20 |
| Search          |         0.140 |   131.46 |   255.45 |
| Game detail     |         0.119 |   261.87 |   527.69 |
| Price history   |         0.134 |   174.56 |   306.77 |
| Genres          |         0.087 |    46.65 |    90.14 |
| Platforms       |         0.067 |    47.89 |    89.17 |
| Alert selection |         0.037 |        — |        — |

The catalog had 47 games, 75 listings, 78 history observations, and zero
alerts. Sequential scans touched small tables, including listings, games, and
snapshots. Taxonomy link tables and the alert workload were empty. These
measurements support keeping the existing API queries and indexes. They do
not characterize performance on a production-sized catalog.

## Redis command usage

Three 180-second samples ran in parallel on disposable, loopback Redis 8.10.3
instances using BullMQ 5.81.5. Each instance contained one queue and one
worker. The sync queue had future 45-minute deal-sync and 60-minute enrichment
schedules. The other queues were empty. Redis `MONITOR` distinguished client
commands from Lua subcommands, and `INFO commandstats` cross-checked the counts.
The table excludes the measurement probes and startup.

| Worker queue          | Before BZPOPMIN + EVALSHA | After BZPOPMIN + EVALSHA | Lua calls before → after |
| --------------------- | ------------------------: | -----------------------: | -----------------------: |
| `sync-deals`          |                   18 + 24 |                    2 + 5 |                 144 → 30 |
| `evaluate-alerts`     |                    6 + 12 |                    2 + 5 |                  72 → 30 |
| `alert-emails`        |                    6 + 12 |                    2 + 5 |                  72 → 30 |
| Total client commands |                    **78** |                   **21** |                 288 → 90 |

Idle client commands fell **73%**, from **37,440 to 10,080/day** or
**1,123,200 to 302,400 per 30 days** when extrapolated from these windows.
The worker uses 90-second idle waits and 60-second stalled checks. It also
caps waits for delayed jobs at 90 seconds or the next due time, whichever is
sooner. BullMQ retains its marker wake-ups, connection watchdog, job locks,
retry settings, and persistent schedules. A stopped worker may take longer to
recover a stalled job. Keeping the three queues preserves pending jobs and
keeps email and slow sync work from holding up alert evaluation.

A separate Redis probe measured two client commands for a cache miss and fill,
one for a hit, and three client script calls for two back-to-back permits for
each provider. Those permits include a rejected attempt that enforces provider
spacing. A fixture job from enqueue through completion used four client
commands. HTTP rate limits use memory. Rates are served from process memory
while fresh, and provider cache hits bypass Redis rate-limit permits. A normal
cache hit needs no write. Negative-cache entries and the last-known rates copy
serve distinct purposes.

| Daily workload allowance                                                                       | Client commands/day |
| ---------------------------------------------------------------------------------------------- | ------------------: |
| 32 sync jobs, 32 alert evaluations, 24 enrichment jobs, up to 100 email jobs, at 10 calls each |               1,880 |
| 32 CheapShark syncs at 15 calls each for cache and permits                                     |                 480 |
| 24 enrichment runs at 150 calls each for caches and permits                                    |               3,600 |
| One rates refresh                                                                              |                   4 |
| Total active allowance                                                                         |           **5,964** |

With that same active allowance added to both measurements, the whole-system
estimate falls from **43,404/day (1,302,120/30 days)** to **16,044/day
(481,320/30 days)**. This fits the 500,000-command Upstash allowance in the
modeled single-worker deployment, leaving **18,680 commands per 30 days**.
The allowances are estimates. Live usage depends on retries, lock renewals,
reconnections, job volume, extra workers, and the provider's metering. Upstash
reports internal Lua commands separately in its Insights API. Check the
database's metered usage after deployment before relying on the headroom.
[Upstash pricing](https://upstash.com/pricing/redis) ·
[Upstash traffic metrics](https://upstash.com/docs/devops/developer-api/redis/get_database_traffic)

If live usage outgrows Free, Upstash Pay as You Go lists **$0.20 per 100,000
commands** and keeps the existing Redis integration. Render's paid
Redis-compatible Key Value starts at **$10/month for 256 MB** with disk-backed
persistence and capacity pricing. A DigitalOcean Basic Droplet lists
**$6/month for 1 GiB** or **$12/month for 2 GiB** and can keep the worker and a
self-managed Redis instance on the same VM. That option leaves patching,
backups, memory sizing, and recovery to the operator. The provider remains
unchanged. [Upstash pricing](https://upstash.com/pricing/redis) ·
[Render pricing](https://render.com/pricing) ·
[DigitalOcean pricing](https://www.digitalocean.com/pricing/droplets)

To repeat the idle measurements, pass the path to a local Redis server
executable with `redis-cli` in the same directory. The script owns the
temporary instances and uses loopback ports 16410–16412.

```powershell
node --import tsx scripts/phase6-redis-commands.mjs "C:\path\to\redis-server.exe" baseline
node --import tsx scripts/phase6-redis-commands.mjs "C:\path\to\redis-server.exe" tuned
```
