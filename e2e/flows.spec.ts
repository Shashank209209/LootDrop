import { expect, test, type Page } from '@playwright/test';
import { fixtureEmail, fixturePassword, mockApi, title } from './fixtures.js';

async function credentials(page: Page) {
  await page.getByLabel('Email address').fill(fixtureEmail);
  await page.getByLabel('Password', { exact: true }).fill(fixturePassword);
}

test('filters and pages deals, uses keyboard search, and shows approximate chart prices', async ({
  page,
}) => {
  await mockApi(page, { authenticated: true, populated: false, error: false });
  await page.goto('/');
  const deals = page.getByRole('region', { name: 'Game catalog' });
  await expect(deals.getByRole('link', { name: title })).toBeVisible();
  await page.getByRole('combobox', { name: 'Store', exact: true }).selectOption('steam');
  await expect(page).toHaveURL((url) => url.searchParams.get('store') === 'steam');
  const genre = page.getByRole('checkbox', { name: /Indie/ });
  await genre.press('Space');
  await expect(genre).toBeChecked();
  await page.getByRole('combobox', { name: /Sort/ }).selectOption('rating_desc');
  await expect(page).toHaveURL((url) => url.searchParams.get('sort') === 'rating_desc');
  await deals.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('store') === 'steam' &&
      url.searchParams.get('genre') === 'indie' &&
      url.searchParams.get('sort') === 'rating_desc' &&
      url.searchParams.get('page') === '2',
  );
  await expect(deals.getByText('Page 2 of 2')).toBeVisible();

  const search = page.getByRole('combobox', { name: 'Search games' });
  await search.fill('cel');
  await expect(page.getByRole('option', { name: /Celeste/ })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  const history = page.waitForResponse((response) =>
    response.url().includes('price-history?range=30d'),
  );
  await page.getByRole('button', { name: '30d' }).click();
  expect((await history).ok()).toBe(true);
  await page.getByRole('combobox', { name: 'Currency' }).selectOption('INR');
  await expect(page.getByRole('heading', { name: /INR.*approximate/ })).toBeVisible();
  await expect(page.getByTitle('$4.99 USD').first()).toHaveText('≈₹424.15');
});

test('registers and signs in, manages a wishlist and alert, and opens notifications', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/');
  const landing = page.getByRole('heading', { name: 'Find your next game for less.' });
  await expect(landing).toBeVisible();
  await expect(page.getByRole('region', { name: 'Game catalog' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Display name').fill('Demo Player');
  await credentials(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Demo Player' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sale status' })).toHaveValue('all');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(landing).toBeVisible();
  await page.getByRole('link', { name: 'Log in' }).click();
  await credentials(page);
  await page.getByRole('button', { name: 'Log in' }).click();
  const deals = page.getByRole('region', { name: 'Game catalog' });
  await deals.getByRole('button', { name: 'Add to wishlist' }).click();
  await page.getByRole('link', { name: 'Wishlist' }).click();
  await expect(page.getByRole('heading', { name: 'My wishlist' })).toBeVisible();
  await page.getByRole('link', { name: title }).click();

  await page.getByRole('button', { name: 'Set alert', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Target price (USD)').fill('3.50');
  await dialog.getByRole('button', { name: 'Set alert' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Alert saved successfully.');
  await dialog.getByRole('button', { name: 'Close alert dialog' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('link', { name: 'Alerts' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);

  await page.getByRole('button', { name: /Notifications, 1 unread/ }).click();
  await expect(page.getByRole('region', { name: 'Recent notifications' })).toContainText(
    'Celeste reached your price target.',
  );
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});

test('recovers from a deals API error using Retry', async ({ page }) => {
  const api = await mockApi(page, { authenticated: true, populated: false, error: true });
  await page.goto('/');
  const deals = page.getByRole('region', { name: 'Game catalog' });
  await expect(deals.getByRole('alert')).toContainText('Catalog temporarily unavailable', {
    timeout: 15_000,
  });
  api.restoreDeals();
  await deals.getByRole('button', { name: 'Retry' }).click();
  await expect(deals.getByRole('link', { name: title })).toBeVisible();
});
