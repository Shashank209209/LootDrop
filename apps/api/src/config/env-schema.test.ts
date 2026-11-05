import { describe, expect, it } from 'vitest';
import { dealSyncIntervalSchema } from './env-schema.js';

describe('deal sync interval', () => {
  it('accepts 30 and 60 minutes', () => {
    expect(dealSyncIntervalSchema.parse(30)).toBe(30);
    expect(dealSyncIntervalSchema.parse(60)).toBe(60);
  });

  it('rejects intervals outside 30 to 60 minutes', () => {
    expect(dealSyncIntervalSchema.safeParse(29).success).toBe(false);
    expect(dealSyncIntervalSchema.safeParse(61).success).toBe(false);
  });
});
