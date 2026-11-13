# LootDrop

LootDrop tracks game prices and sends notifications when a saved price rule is met.

## Price alerts

Create alerts from a game page or wishlist. Each alert watches one game and either
a selected store or the cheapest listing in the alert's currency:

- **Price drops below** fires when a matching price is at or below the target.
- **Discount reaches** fires when a matching discount is at or above the target.
- **Any sale starts** fires when a matching listing is marked on sale.
- **New all-time low** fires when the current price is no higher than its historical
  low; at least two price snapshots for that listing and currency are required.

Prices are compared only within the alert currency. An alert can trigger at most
once per 24-hour cooldown, and a still-true condition will not repeatedly notify.
It re-arms after an evaluation finds the condition false. Email is capped at 20
messages per user in a rolling 24-hour period. In-app notifications are created
when an alert fires; email delivery is separate.

Email is disabled by default: `EMAIL_PROVIDER=log` writes one masked log line and
sends nothing. To enable the Resend provider, set these API environment variables:

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY` — your Resend API key
- `EMAIL_FROM` — a verified sender address

With the default `EMAIL_PROVIDER=log`, no mail credentials are required. The API
environment template is [apps/api/.env.example](apps/api/.env.example).

### Safe child-branch testing

Use the isolated Neon child branch `lootdrop / phase-4-test / neondb`, not
production. Put its direct and pooled URLs in the root `.env` as
`DIRECT_URL_PHASE4_TEST` and `DATABASE_URL_PHASE4_TEST`. The guard verifies those
targets, rejects production matches, overrides database variables only for the
child process, forces the log email provider, and uses a unique queue prefix.
The live Phase 4 check calls the sync and evaluator directly; it does not start
a BullMQ worker or register the recurring sync schedule.

From PowerShell, run the real integration check with:

```powershell
node scripts/phase4-test-guard.mjs -- npx tsx apps/api/scripts/phase4-live-check.ts
```

For one explicitly named, store-scoped throwaway `PRICE_BELOW` alert, the
development-only simulator temporarily changes the named listing's price,
evaluates it, sends no real email, and restores the listing price:

```powershell
node scripts/phase4-test-guard.mjs -- npx tsx apps/api/scripts/phase4-simulate-drop.ts --alert <alert-uuid> --price 0.01
```

Replace the alert placeholder with an ID from the child branch and use a price
below both the listing's current price and the alert target. The simulator
refuses production, unguarded execution, non-throwaway users, and ambiguous
alerts or listings.
