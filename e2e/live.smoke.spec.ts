import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';
import { assertPhase6Test } from '../scripts/phase6-test-guard.mjs';

test('guarded full-stack registration, login, wishlist, alert, and logout', async ({ page }) => {
  assertPhase6Test();
  const database = new PrismaClient();
  const email = ['phase6-check-' + randomUUID(), 'example.invalid'].join('@');
  const password = randomBytes(32).toString('base64url');
  const owner = { email };
  let stage = 'registration';
  let failure: string | undefined;
  const fillCredentials = async (browser: Page) => {
    await browser.getByLabel('Email address').fill(email);
    await browser.getByLabel('Password', { exact: true }).fill(password);
  };

  try {
    await page.route('**/api/v1/rates', (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: { code: 'RATES_UNAVAILABLE', message: 'Reference rates disabled in smoke check' },
        },
      }),
    );
    await page.goto('/register');
    await page.getByLabel('Display name').fill('Phase 6 Smoke Check');
    await fillCredentials(page);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(
      page.getByRole('heading', { name: 'Welcome back, Phase 6 Smoke Check' }),
    ).toBeVisible();

    stage = 'login';
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByRole('link', { name: 'Log in' }).click();
    await fillCredentials(page);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(
      page.getByRole('heading', { name: 'Welcome back, Phase 6 Smoke Check' }),
    ).toBeVisible();

    stage = 'wishlist';
    const listing = page.getByRole('region', { name: 'Game catalog' }).getByRole('article').first();
    const listingLink = listing.getByRole('heading').getByRole('link');
    const game = await listingLink.innerText();
    const gamePath = await listingLink.getAttribute('href');
    const added = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/wishlist') && response.request().method() === 'POST',
    );
    await listing.getByRole('button', { name: 'Add to wishlist' }).click();
    expect((await added).ok()).toBe(true);
    stage = 'opening the saved wishlist';
    await page.getByRole('link', { name: 'Wishlist' }).click();
    const savedGame = page
      .getByRole('region', { name: 'Wishlisted games' })
      .getByRole('heading')
      .getByRole('link');
    await expect(savedGame).toHaveAttribute('href', gamePath!);
    await savedGame.click();

    stage = 'alert and logout';
    await page.getByRole('button', { name: 'Set alert', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Target price (USD)').fill('1.00');
    await dialog.getByRole('button', { name: 'Set alert' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Alert saved successfully.');
    await dialog.getByRole('button', { name: 'Close alert dialog' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('link', { name: 'Alerts' }).click();
    await expect(page.getByRole('link', { name: game, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  } catch {
    failure = 'Guarded smoke check failed at ' + stage;
    await page.goto('about:blank').catch(() => {});
  } finally {
    try {
      const user = await database.user.findUnique({
        where: owner,
        select: {
          id: true,
          _count: { select: { wishlists: true, priceAlerts: true, refreshTokens: true } },
        },
      });
      const removed = await database.user.deleteMany({ where: owner });
      const remaining = await database.user.count({ where: owner });
      console.log(
        'Smoke cleanup ' +
          JSON.stringify({
            removed: removed.count,
            remaining,
            cascaded: user?._count ?? {},
          }),
      );
      if (remaining !== 0) failure = 'Guarded smoke cleanup left owned test rows';
    } catch {
      failure = 'Guarded smoke cleanup could not complete';
    } finally {
      await database.$disconnect().catch(() => {
        failure = 'Guarded smoke cleanup could not disconnect';
      });
    }
  }
  if (failure) throw new Error(failure);
});
