import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
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
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: fileURLToPath(new URL(`${screen.name}.png`, directory)),
      animations: 'disabled',
      fullPage: true,
    });
  });
}
