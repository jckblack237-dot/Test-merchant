# LoyaltyLoop

A customer retention platform you can sell as a monthly subscription.

Merchants — coffee chains, bakeries, any repeat-purchase business — get a
loyalty programme and a CRM. Their customers get one app holding every
programme they belong to. You get a multi-tenant SaaS with plans, limits and a
paywall already wired in.

**The security promise the product is sold on: a merchant sees their own data
and nothing else.** That isolation is enforced in the data layer, not by
remembering to write a filter, and 28 automated tests hand one merchant another
merchant's real record ids and prove every read and write is refused.

---

## What's in the box

| | |
|---|---|
| **Customer app** (`apps/customer`) | Mobile-first wallet: discover programmes, join, see points and tier progress, browse menus and shops, redeem rewards, show a scannable code at the counter. |
| **Merchant site + CRM** (`apps/merchant`) | Public marketing site with live pricing and self-serve signup, plus the signed-in CRM: dashboard, member database, counter tool, redemption queue, catalogue, team, billing, audit log. |
| **API** (`server`) | Node + Express + SQLite. Loyalty engine, three kinds of login, subscription plans, per-tenant audit logging. |

## Running it

```bash
npm install
npm run seed --workspace server -- --reset   # demo data: two competing coffee chains
npm run dev                                  # API :4000, customer :5173, merchant :5174
```

Then open:

- **http://localhost:5174** — marketing site and merchant CRM
- **http://localhost:5173** — customer wallet app

### Demo logins

Everything below uses the password `demo12345`.

**Merchant CRM** (http://localhost:5174)

| Business | Email | Role |
|---|---|---|
| Zuz Coffee | `owner@zuzcoffee.test` | owner |
| Zuz Coffee | `marcus@zuzcoffee.test` | manager |
| Zuz Coffee | `priya@zuzcoffee.test` | staff |
| Bloom Bakehouse | `owner@bloombakehouse.test` | owner |

**Customer app** (http://localhost:5173) — `aisha@example.com`, `ben@example.com`,
`grace@example.com`, and others in the seed output.

### See the isolation for yourself

Grace, Hugo and Ivy are members of **both** chains. Sign in as Zuz's owner, open
Members, and note their balances. Sign in as Bloom's owner and look at the same
three people: different balances, different history, different notes. Neither
owner can see the other's numbers, and neither can tell the other programme
exists. Copy a member id out of Zuz's URL bar and paste it into Bloom's — you
get "not found", not "forbidden", because confirming the id is real would itself
leak information.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs API and both frontends together |
| `npm run dev:server` / `dev:customer` / `dev:merchant` | One at a time |
| `npm test` | Backend test suite (97 tests) |
| `npm run typecheck` | TypeScript across all three packages |
| `npm run build` | Production build of everything |
| `npm run seed --workspace server -- --reset` | Rebuild demo data from scratch |

## How the loyalty engine works

Points are an **append-only ledger**. A member's balance is a cached projection
of that ledger, updated inside the same database transaction as the entry that
caused it, so a balance can never drift from the history that explains it.

An award is calculated as:

```
base           = amount spent x the merchant's points-per-currency rate
tier bonus     = x the member's current tier multiplier
campaign bonus = x any running multiplier campaigns, + any flat bonuses
```

Product-level overrides replace the base rate for specific items. A POS can pass
a `reference` with each award; sending the same reference twice returns the
original result rather than paying the customer twice, so a till that retries a
timed-out request cannot double-award.

Redemption checks the balance, decrements stock and writes the ledger entry in
one transaction, so two simultaneous redemptions can never both pass the balance
check. Cancelling a redemption returns the points as a `refund` entry rather than
editing history.

## Subscription model

Three plans (`starter` / `growth` / `scale`) ship in `server/src/db/plans.ts`,
with limits on locations, staff seats and members. Limits are enforced when a
merchant tries to add one more of something, so the paywall is real and not
cosmetic. New signups get a 14-day trial.

When a subscription lapses, **writes are blocked but reads stay open**: a
merchant who stops paying can always still see and export their own customer
list. Downgrades that would strand data are refused with an explanation rather
than silently switching things off.

There is no payment processor wired in — `POST /api/merchant/account/billing/plan`
is where a Stripe subscription would be created. The entitlement record lives in
the `merchants` table either way, so the paywall keeps working whatever processor
you connect.

## Documentation

- **[docs/SECURITY.md](docs/SECURITY.md)** — the tenant isolation design, the
  threat model, and what is deliberately not built yet.
- **[docs/API.md](docs/API.md)** — every endpoint, with the POS integration guide.
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — going to production, including
  the migration path off SQLite.

## Project layout

```
server/
  src/
    config.ts             environment and secret loading
    db/
      schema.ts           the whole SQL schema, with tenancy notes
      tenant.ts           TenantStore — the isolation boundary
      plans.ts            subscription catalogue
      seed.ts             demo data
    lib/                  ids, tokens, passwords, errors, validators
    middleware/           auth, role gates, paywall, rate limits, errors
    routes/
      auth.ts             merchant + customer login, signup, refresh
      public.ts           pricing and the merchant directory
      customer.ts         the customer app's API
      merchant/           the CRM's API
    services/             loyalty engine, sessions, subscriptions, onboarding
  tests/                  97 tests, 28 of them cross-tenant attacks
apps/
  customer/               React wallet app
  merchant/               React marketing site + CRM
```
