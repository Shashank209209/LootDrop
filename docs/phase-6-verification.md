# Phase 6 verification

## Automated checks

Run from the repository root with Node 24. PowerShell users can use `npm.cmd` if the PowerShell shim is blocked.

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:e2e:smoke
npm audit --omit=dev
```

The first five commands follow the GitHub Actions quality gate. The mocked browser checks exercise the real web app without a database. The CI workflow can run those checks via its manual input. The smoke test requires the Phase 6 Neon child branch variables and deletes the throwaway account it creates. See the [environment table](../README.md#environment-variables) and [known dependency advisories](known-issues.md).

To reproduce the Notifications stability check with Axe and all three responsive widths, run this command after building the shared contracts.

```powershell
npx playwright test --project=mocked --grep 'notifications (passes|fits)' --repeat-each 5 --workers 1
```

The shared screen helper waits for the game link in the full Notifications page. The notification message belongs to the header dropdown.

## Browser checklist

- Browse deals, change a store and genre filter, go to page 2, and reload. Check that filters and pagination stay in the URL.
- Tab to game search. Use Arrow Down to select a game, Escape to dismiss, and Enter to open a result. Confirm focus is visible.
- Compare listings and change the history range. Switch to INR or EUR and check that approximate prices still identify the original amounts.
- On a local or guarded child-branch account, save a game, create a price alert, pause or delete it, and check the notification bell and Notifications page. Confirm the alert dialog traps focus and returns it to the trigger when closed.
- Verify that invalid registration fields are identified and described. Log out and confirm the Wishlist page redirects to login.
- Check the dashboard, game detail, wishlist, alerts, login, registration, and notifications at 390, 768, and 1280 pixels. The comparison table can scroll within its own container.
- Enable reduced motion and confirm loading placeholders and controls stop animating. Navigate to a valid page and an unknown route and verify unique page titles and the recovery link.
