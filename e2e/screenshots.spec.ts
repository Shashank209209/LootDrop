import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { openScreen, screens } from './screens.js';

const directory = new URL('../docs/screenshots/', import.meta.url);

test.use({
  viewport: { width: 1280, height: 900 },
  locale: 'en-US',
  timezoneId: 'UTC',
  reducedMotion: 'reduce',
});

for (const screen of screens) {
  test(`capture ${screen.name}`, async ({ page }) => {
    await openScreen(page, screen);
    const text = await page.locator('body').innerText();
    expect(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\bBearer\s+\S+/i.test(text)).toBe(false);
    for (const input of await page.locator('input[type="email"], input[type="password"]').all()) {
      await expect(input).toHaveValue('');
      expect((await input.getAttribute('placeholder'))?.includes('@') ?? false).toBe(false);
    }
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: fileURLToPath(new URL(`${screen.name}.png`, directory)),
      animations: 'disabled',
      fullPage: true,
    });
  });
}
