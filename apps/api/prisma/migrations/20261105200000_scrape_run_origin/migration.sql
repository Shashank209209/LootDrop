CREATE TYPE "scrape_run_source" AS ENUM ('SCHEDULED', 'MANUAL', 'UNKNOWN');

ALTER TABLE "scrape_runs" RENAME COLUMN "source" TO "provider";

ALTER TABLE "scrape_runs"
ADD COLUMN "source" "scrape_run_source" NOT NULL DEFAULT 'UNKNOWN';

UPDATE "scrape_runs"
SET "source" = 'UNKNOWN'
WHERE "source" IS DISTINCT FROM 'UNKNOWN';

ALTER INDEX "scrape_runs_source_started_at_idx"
RENAME TO "scrape_runs_provider_started_at_idx";

CREATE INDEX "scrape_runs_source_started_at_idx"
ON "scrape_runs"("source", "started_at" DESC);
