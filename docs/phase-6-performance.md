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

## Redis usage estimate

At continuous uptime with one worker process, three BullMQ consumers account
for roughly 26,000–38,000 client commands per day from blocking waits, work
checks, and stalled-job checks. Periodic deal sync, enrichment, alert work and
cache traffic bring the modeled total to about **26,000–42,000 commands per
day**. A healthy rates refresh adds about four commands per day. This is a
model based on installed BullMQ timers, not usage telemetry, and excludes Lua
subcommands and extra replicas. At that rate the system can exceed Upstash's
500,000 commands per month free allowance. Compare the estimate with measured
project usage before hosting. [Upstash Redis pricing](https://upstash.com/pricing/redis)
