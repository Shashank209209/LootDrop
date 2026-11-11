import type { DealSyncQuery } from '../pricing/contracts.js';
import type { SyncDealsResult } from '../pricing/ingest-deals.js';

export async function runSyncAndEnqueueAlerts(
  query: DealSyncQuery,
  dependencies: {
    runSync: (query: DealSyncQuery) => Promise<SyncDealsResult>;
    enqueueEvaluation: (
      input: Pick<SyncDealsResult, 'scrapeRunId' | 'checkedListingIds'>,
    ) => Promise<void>;
  },
): Promise<SyncDealsResult> {
  const result = await dependencies.runSync(query);
  if (result.checkedListingIds.length > 0) {
    await dependencies.enqueueEvaluation({
      scrapeRunId: result.scrapeRunId,
      checkedListingIds: result.checkedListingIds,
    });
  }
  return result;
}
