# Phase 6 security review

| Area                    | Initial result | Evidence and action                                                                                                                                                        |
| ----------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORS                    | PASS           | Credentialed requests use the configured exact browser origin.                                                                                                             |
| Refresh and logout      | FIX            | These cookie endpoints now require the trusted Origin or Referer.                                                                                                          |
| Cookie flags            | PASS           | HttpOnly is always set. Secure defaults on in production and SameSite=None requires Secure.                                                                                |
| Rate limits             | FIX            | Registration and login already had strict limits. Refresh now shares the strict limit and every API route is covered by the global limiter. Trusted proxy hops are opt-in. |
| Request errors          | FIX            | The JSON parser already capped bodies at 1 MiB. Oversized and malformed requests now have explicit 413 and 400 responses. The 404 and 500 responses carry static messages. |
| Validation and ordering | PASS           | All accepted application inputs use the schemas below. Every Prisma orderBy is a static expression or a schema-validated enum mapped to static expressions.                |
| Raw SQL                 | PASS           | Alert evaluation, alert creation and enrichment use Prisma tagged templates or Prisma.sql with bound values. Alert ID collections use Prisma.join.                         |
| Headers                 | PASS           | Express applies Helmet. [Example web host headers](web-headers.example) preserve HTTPS cover images and Recharts inline styles.                                            |
| Logging                 | FIX            | HTTP completion logs omit request targets, headers, bodies and raw errors. Worker and seed error logs omit exception messages.                                             |
| History                 | PASS           | Checked 120 reachable commits against configured private values and common key signatures. Only public env templates are tracked.                                          |
| Dependencies            | PASS           | Production audit found zero new advisories. No compatible release fixes the documented Prisma and Zod advisories. Dependabot tracks npm and GitHub Actions weekly.         |

## Route inputs

All routes below use the `/api/v1` prefix unless the whole path is shown.

| Routes                                                                                          | Accepted request inputs                                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET /deals                                                                                      | Shared Zod query validates text, price bounds, sale, facets, sort and pagination.                |
| GET /deals/best, /deals/free, /deals/historical-lows                                            | Each validates its optional limit with a shared Zod query.                                       |
| GET /games/search                                                                               | Shared Zod query validates the title search.                                                     |
| GET /games/{slug}, /games/{slug}/price-history                                                  | Zod slug schema. History also validates store and range in its Zod query.                        |
| POST /auth/register, /auth/login                                                                | Strict shared Zod bodies.                                                                        |
| POST /auth/refresh, /auth/logout                                                                | No query or body fields. Cookie token and request origin are checked explicitly.                 |
| GET /auth/me                                                                                    | No query or body fields. The bearer token identifies the user.                                   |
| PATCH /me/preferences                                                                           | Strict shared Zod currency body plus bearer authentication.                                      |
| GET /wishlist                                                                                   | Shared Zod pagination query and bearer authentication.                                           |
| POST /wishlist, DELETE /wishlist/{gameId}                                                       | Zod body or UUID path plus bearer authentication.                                                |
| GET /alerts, POST /alerts, PATCH /alerts/{alertId}, DELETE /alerts/{alertId}                    | Shared Zod pagination, create/update bodies and UUID path checks. Bearer authentication applies. |
| GET /notifications, PATCH /notifications/{notificationId}/read                                  | Shared Zod query or UUID path validation plus bearer authentication.                             |
| GET /wishlist/ids, /notifications/unread-count, PATCH /notifications/read-all                   | Authentication only.                                                                             |
| GET /stores, /genres, /platforms, /rates, /api/v1/health, /health, /docs and /docs/openapi.json | Public reads with no supported user input.                                                       |

The router ignores unused inputs on no-input routes. Sort mapping is in
`deals-router.ts`; the other selected orders are expressed in their Prisma
queries.
