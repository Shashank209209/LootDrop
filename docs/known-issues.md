# Known issues

## Metadata enrichment

- Games without one exact normalized RAWG match stay uncategorized. Editions,
  bundles and games indexed under another title can fall into this group.
- Enrichment considers games with an empty RAWG ID. Existing fields and links
  are preserved, and missing provider data can remain empty after a match.
- Platform filters use seeded platforms. Console family data alone is
  insufficient to identify a specific generation.

## Currency display

- Converted amounts are display estimates. The chart applies one reference
  rate to the entire history, and actual store checkout amounts can depend on
  region or fees.
- Price filters use the original USD amounts in the tracked catalog. Alert
  thresholds use the listing's original currency. Historical observations and
  alert decisions use the stored prices.
- During a rates outage, the API can serve rates from the last successful fetch
  within seven days. The UI falls back to original values when the rates
  endpoint cannot supply usable rates.

## Dependency advisories

- **High — `effect`**. Prisma 6.19.3 brings in `effect` 3.21.0 through
  `@prisma/config`. The advisory covers denial of service when untrusted
  input reaches an affected template-literal schema. LootDrop does not
  directly import Effect. The advisory lists 3.22.1 as the patched version.
  [GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw)

- **High — `deepmerge-ts`**, pulled in by `@prisma/config` and the Prisma CLI. The advisory requires merging recursive object graphs. The CLI is used for development and database administration, and the reviewed app has no request path that passes remote input into Prisma configuration merging. The audit's suggested fix is Prisma 7.10.1, a major upgrade from the current Prisma 6 line; do not force this upgrade without validating the migration.
- **High — `zod`**, used with `@asteasolutions/zod-to-openapi`. The advisory concerns memory exhaustion when validating oversized constrained collections. Although Zod validates API inputs, the reviewed request schemas do not expose the affected constrained-array validation to attacker-controlled collections; the constrained arrays are response schemas or database-bounded data. The available compatible toolchain fix requires Zod 4.6.7 and `@asteasolutions/zod-to-openapi` 9.1.0, major upgrades from Zod 3 and OpenAPI integration 7.
