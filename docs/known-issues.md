# Known issues

Re-check these advisories before deployment:

- **High — `deepmerge-ts`**, pulled in by `@prisma/config` and the Prisma CLI. The advisory requires merging recursive object graphs. The CLI is used for development and database administration, and the reviewed app has no request path that passes remote input into Prisma configuration merging. The audit's suggested fix is Prisma 7.10.1, a major upgrade from the current Prisma 6 line; do not force this upgrade without validating the migration.
- **High — `zod`**, used with `@asteasolutions/zod-to-openapi`. The advisory concerns memory exhaustion when validating oversized constrained collections. Although Zod validates API inputs, the reviewed request schemas do not expose the affected constrained-array validation to attacker-controlled collections; the constrained arrays are response schemas or database-bounded data. The available compatible toolchain fix requires Zod 4.6.7 and `@asteasolutions/zod-to-openapi` 9.1.0, major upgrades from Zod 3 and OpenAPI integration 7.
