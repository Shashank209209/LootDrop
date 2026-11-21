import { expect, it } from 'vitest';
import { stopWithDeadline } from './shutdown.js';

it('waits for successful cleanup', async () => {
  let closed = false;
  expect(
    await stopWithDeadline(async () => {
      closed = true;
    }, 100),
  ).toBe(true);
  expect(closed).toBe(true);
});
it('bounds cleanup when a dependency stalls', async () => {
  expect(await stopWithDeadline(() => new Promise(() => {}), 5)).toBe(false);
});
it('contains a cleanup rejection', async () => {
  expect(
    await stopWithDeadline(async () => {
      throw new Error('fixture');
    }, 100),
  ).toBe(false);
});
