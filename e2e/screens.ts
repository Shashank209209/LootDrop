import { expect, type Page } from '@playwright/test';
import { mockApi } from './fixtures.js';

export const viewports = [390, 768, 1280];

export const screens = [
  { name: 'dashboard', path: '/', title: 'Game deals', heading: 'Welcome back, Demo Player' },
  { name: 'game-detail', path: '/games/celeste', title: 'Celeste', heading: 'Celeste' },
  { name: 'wishlist', path: '/wishlist', title: 'My wishlist', heading: 'My wishlist' },
  { name: 'alerts', path: '/alerts', title: 'Price alerts', heading: 'Price alerts' },
  {
    name: 'login',
    path: '/login',
    title: 'Log in',
    heading: 'Track the best game deals before everyone else.',
    guest: true,
  },
  {
    name: 'register',
    path: '/register',
    title: 'Register',
    heading: 'Track the best game deals before everyone else.',
    guest: true,
  },
  {
    name: 'notifications',
    path: '/notifications',
    title: 'Notifications',
    heading: 'Notifications',
  },
];

export async function openScreen(page: Page, screen: (typeof screens)[number]) {
  await mockApi(page, { authenticated: !screen.guest, populated: true, error: false });
  await page.goto(screen.path);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible();
  if (screen.name === 'game-detail') {
    await expect(main.getByRole('img', { name: /price observations/ })).toBeVisible();
  } else if (screen.name === 'notifications') {
    const notification = main.getByRole('link', { name: /^Celeste\b/ });
    await expect(notification).toBeVisible();
    await expect(notification).toHaveAttribute('href', '/games/celeste');
  } else if (!screen.guest) {
    await expect(main.getByRole('link', { name: 'Celeste', exact: true }).first()).toBeVisible();
  }
  await expect(page).toHaveTitle(screen.title + ' | LootDrop');
  return main;
}
