import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures.js';
import { openScreen, screens, viewports } from './screens.js';

for (const screen of screens) {
  test(`${screen.name} passes accessibility checks`, async ({ page }) => {
    const main = await openScreen(page, screen);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations
        .filter(
          ({ impact, id }) =>
            impact === 'serious' || impact === 'critical' || id === 'color-contrast',
        )
        .map(({ id, impact, nodes }) => ({
          id,
          impact,
          targets: nodes.map(({ target }) => target),
        })),
    ).toEqual([]);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
    const levels = await main
      .getByRole('heading')
      .evaluateAll((elements) => elements.map((element) => Number(element.tagName.slice(1))));
    expect(levels.filter((level, index) => level > (levels[index - 1] ?? 0) + 1)).toEqual([]);
  });

  for (const width of viewports) {
    test(`${screen.name} fits at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await openScreen(page, screen);
      const layout = await page.evaluate(() => {
        const controls = Array.from(document.querySelectorAll('a[href], button, input, select'))
          .filter((element) => !element.closest('.table-scroll'))
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 1 && rect.height > 1);
        const overlaps = controls.flatMap(({ element, rect }, index) =>
          controls
            .slice(index + 1)
            .filter(
              ({ element: other, rect: box }) =>
                !element.contains(other) &&
                !other.contains(element) &&
                Math.min(rect.right, box.right) - Math.max(rect.left, box.left) > 2 &&
                Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) > 2,
            )
            .map(({ element: other }) => [
              element.className || element.tagName,
              other.className || other.tagName,
            ]),
        );
        return { extraWidth: document.documentElement.scrollWidth - innerWidth, overlaps };
      });
      expect(layout.extraWidth).toBeLessThanOrEqual(1);
      expect(layout.overlaps).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath('screen.png'),
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
}

test('landing page follows the system theme and remembers an accessible dark mode override', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockApi(page);
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Dark mode' });
  const shell = page.locator('.landing-shell');
  await expect(shell.locator('.landing-hero')).toHaveCSS('display', 'grid');
  await expect(shell.locator('.landing-visual img')).toHaveJSProperty('naturalWidth', 1200);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(shell).toHaveCSS('color-scheme', 'dark');
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(shell).toHaveCSS('color-scheme', 'light');

  await page.emulateMedia({ colorScheme: 'light' });
  await toggle.focus();
  await toggle.press('Enter');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(shell).toHaveCSS('color-scheme', 'dark');
  await expect(page.getByRole('contentinfo')).toHaveCSS('background-color', 'rgb(23, 23, 21)');
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.filter(
      ({ impact, id }) => impact === 'serious' || impact === 'critical' || id === 'color-contrast',
    ),
  ).toEqual([]);
});

test('keyboard focus, autocomplete, and the alert dialog', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page, { authenticated: true, populated: false, error: false });
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search games' });
  await expect(search).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS('outline-width', '3px');
  await expect(search).toHaveCSS('transition-duration', '0s');
  await search.pressSequentially('Cele');
  const results = page.getByRole('listbox', { name: 'Game search results' });
  await expect(results.getByRole('option', { name: /Celeste/ })).toBeVisible();
  await search.press('ArrowDown');
  await expect(results.getByRole('option', { name: /Celeste/, selected: true })).toBeVisible();
  await search.press('Escape');
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await search.press('ArrowDown');
  await search.press('Enter');

  await expect(page).toHaveURL(/\/games\/celeste$/);
  const trigger = page.getByRole('button', { name: 'Set alert', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Celeste' });
  const close = dialog.getByRole('button', { name: 'Close alert dialog' });
  const submit = dialog.getByRole('button', { name: 'Set alert' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Enter a price greater than zero');
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('registration errors are announced and missing pages offer recovery', async ({ page }) => {
  await mockApi(page);
  await page.goto('/register');
  const email = page.getByLabel('Email address', { exact: true });
  await email.fill('invalid');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAccessibleDescription('Invalid email');
  await expect(page.getByRole('alert').filter({ hasText: /^Invalid email$/ })).toBeVisible();
  await page.goto('/missing-page');
  await expect(page).toHaveTitle('Page not found | LootDrop');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to deals' }).click();
  await expect(page.getByRole('heading', { name: 'Find your next game for less.' })).toBeVisible();
});

test('recovers from a failed route bundle using the error boundary', async ({ page }) => {
  await mockApi(page, { authenticated: true, populated: true, error: false });
  const routeModule = /\/src\/components\/NotificationsPage\.tsx(?:\?|$)/;
  await page.route(routeModule, (route) => route.abort(), { times: 1 });
  await page.goto('/notifications');
  const error = page.getByRole('alert');
  await expect(error.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await error.getByRole('link', { name: 'Back to deals' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Demo Player' })).toBeVisible();
});
