import { describe, expect, it, vi } from 'vitest';
import { runSyncAndEnqueueAlerts } from './sync-handler.js';

const query = { pageNumber: 0, pageSize: 20, sortBy: 'DealRating' as const };

describe('runSyncAndEnqueueAlerts', () => {
  it('queues one alert evaluation after a successful sync with checked listings', async () => {
    const result = {
      scrapeRunId: '4a3228ca-3831-426f-8db3-b8b5ed878ec8',
      pagesFetched: 1,
      itemsProcessed: 2,
      itemsFailed: 0,
      checkedListingIds: ['e249e74c-9e0a-479e-a127-d8e1df9b03af'],
    };
    const runSync = vi.fn(async () => result);
    const enqueueEvaluation = vi.fn(async () => {});

    await expect(runSyncAndEnqueueAlerts(query, { runSync, enqueueEvaluation })).resolves.toEqual(
      result,
    );
    expect(enqueueEvaluation).toHaveBeenCalledWith({
      scrapeRunId: result.scrapeRunId,
      checkedListingIds: result.checkedListingIds,
    });
  });

  it('does not enqueue an evaluation when a successful sync checks no listings', async () => {
    const runSync = vi.fn(async () => ({
      scrapeRunId: '4a3228ca-3831-426f-8db3-b8b5ed878ec8',
      pagesFetched: 1,
      itemsProcessed: 0,
      itemsFailed: 0,
      checkedListingIds: [],
    }));
    const enqueueEvaluation = vi.fn(async () => {});

    await runSyncAndEnqueueAlerts(query, { runSync, enqueueEvaluation });
    expect(enqueueEvaluation).not.toHaveBeenCalled();
  });

  it('does not enqueue an evaluation when the sync fails', async () => {
    const runSync = vi.fn(async () => {
      throw new Error('sync failed');
    });
    const enqueueEvaluation = vi.fn(async () => {});

    await expect(runSyncAndEnqueueAlerts(query, { runSync, enqueueEvaluation })).rejects.toThrow(
      'sync failed',
    );
    expect(enqueueEvaluation).not.toHaveBeenCalled();
  });
});
