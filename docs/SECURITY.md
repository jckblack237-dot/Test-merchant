# Security design

The product's central promise is that one merchant on LoyaltyLoop cannot see
another merchant's data. This document explains how that is enforced, what else
is protected, and what is deliberately not built yet.

## Tenant isolation

### The problem with "remember to filter"

The usual way to build multi-tenant software is to write `WHERE merchant_id = ?`
on every query. It works until someone writes the one endpoint that forgets —
and that single omission is a data breach, not a bug. Reviews catch most of
them. "Most" is not a promise you can sell.

### What we do instead

Merchant-owned data is not reachable except through `TenantStore`
(`server/src/db/tenant.ts`). It is constructed once per request, in the auth
middleware, from the merchant id inside the signed access token. Every statement
it builds appends the tenant predicate itself:

```ts
// server/src/db/tenant.ts
find(table, id) {
  const sql = `SELECT * FROM ${table} WHERE id = @__id AND merchant_id = @__merchantId`;
  return this.db.prepare(sql).get({ __id: id, __merchantId: this.merchantId });
}
```

The merchant id is never a parameter a caller can supply:

- `insert()` **overwrites** any `merchant_id` in the payload with the session's.
- `update()` **strips** `merchant_id`, so a row cannot be moved between tenants.
- Reads and deletes always **AND** it into the predicate.
- Request bodies are parsed with schemas that **drop unknown keys**, so
  `merchant_id` never survives as far as the data layer anyway.

An endpoint written without a tenant filter is not possible, because there is no
API that takes one.

### The three places that could still go wrong, and what covers them

**1. A hand-written query for a join or aggregate.** The dashboard needs
`SUM(amount_cents) GROUP BY location`. Those go through `store.query()`, which
runs `assertTenantSafeSql()` first: it scans the `FROM`/`JOIN` targets and throws
if any tenant table is referenced without a bound `merchant_id` filter. It is a
guard rail rather than a SQL parser — the primary protection is still that
`merchantId` is bound for you and cannot come from the client.

**2. Someone adds a merchant-owned table and forgets to register it.**
`assertTenantTablesAreScoped()` runs at boot. It reads the live schema and
throws if any table has a `merchant_id` column but is missing from
`TENANT_TABLES`. The server refuses to start rather than serving one unguarded
table.

**3. A record id from another tenant is guessed or leaked.** Ids are 80 bits of
`crypto.randomBytes` (`mem_gddvg4qn8z02tvxa`), not sequential integers, so
enumeration is not viable. And a lookup that misses returns **404, not 403** —
because 403 confirms the id is real, which lets a competitor map another
merchant's customer count by probing.

### The one deliberately global table

`customers` is not tenant-scoped, on purpose: one person has one login and can
belong to many programmes. What a merchant sees of that person is the
`memberships` row, which **is** scoped. So Zuz Coffee sees its own membership for
Grace — her balance, visits and their private notes about her — and has no way to
learn that Grace also collects points at Bloom Bakehouse. The seed data sets this
up deliberately so you can check it yourself.

### Proof

`server/tests/isolation.test.ts` builds two merchants and a shared customer,
then hands Merchant B a valid token and Merchant A's **real** ids, and asserts
every one of these fails:

- reading a member, location, product, reward, tier or campaign
- finding them via list endpoints, or by searching the customer's exact email
- reading the ledger, redemption queue, redemption codes, audit log or team list
- awarding points, adjusting a balance, annotating a member
- editing or deleting any catalogue record
- fulfilling or cancelling a redemption
- modifying another merchant's staff
- smuggling `merchant_id` into a create payload, or into an update to move a row
- reading another merchant's figures in dashboard aggregates or the CSV export

It also asserts the same ids work fine for their real owner, so the tests cannot
pass by accident on ids that do not exist.

## Authentication

**Three kinds of principal**, each with its own token audience so one cannot be
replayed as another:

| Principal | Signs in via | Scope |
|---|---|---|
| Merchant staff | `/api/auth/merchant/login` | Exactly one merchant, at one of three role levels |
| Customer | `/api/auth/customer/login` | Only their own memberships |
| POS API key | `Authorization: Bearer llk_…` | Award points and look members up. Nothing else. |

**Passwords** are bcrypt at cost 12. A login for an address with no account
still runs a bcrypt comparison against a dummy hash, so response timing does not
reveal which addresses are registered, and both cases return the same message.
Eight failures locks the account for 15 minutes.

**Access tokens** are JWTs that live 30 minutes and are held in memory by the
frontends — never in `localStorage`, so a stored XSS payload cannot read one out
of persistent storage.

**Refresh tokens** are 48 random bytes, stored only as a SHA-256 hash, and are
rotated on every use. Presenting one that has already been rotated is treated as
a stolen-token replay: every live session for that principal is revoked at once,
logging the attacker and the real user out together, and the event is recorded.
Disabling an account, changing its role or changing its password also revokes
its live sessions immediately.

**The wallet QR** is a short-lived signed token, not a JWT:

```
mem_gddvg4qn8z02tvxa.tkshx2.LSJd22WlizjDeDKQ
membership id       . expiry . truncated HMAC
```

Two reasons. It expires in two minutes, so a screenshot of someone's code is not
a durable credential. And at ~44 characters it produces a far sparser QR than a
240-character JWT, which matters when a phone screen is being held over a till
scanner. The 96-bit truncated HMAC-SHA256 is ample for a value that is already
expired by the time any attack could finish. Staff resolve the code through their
own tenant store, so a code minted for another shop's programme finds no member —
it reads as "not a member here" rather than revealing where else the person shops.

## Roles

Enforced server-side by `requireRole()`; the CRM navigation mirrors it so staff
are not shown controls the API would refuse.

| | Staff | Manager | Owner |
|---|---|---|---|
| Look up members, award points, hand over rewards | ✓ | ✓ | ✓ |
| Manually adjust balances, edit member records, cancel redemptions | | ✓ | ✓ |
| Manage catalogue, read team list and audit log | | ✓ | ✓ |
| Manage tiers, staff accounts, API keys, billing, settings | | | ✓ |

A merchant cannot demote, disable or delete its last active owner, so a tenant
cannot lock itself out of its own account.

## Other measures

- **Input validation** — every body and query is parsed by a Zod schema that
  strips unknown keys. Nothing reaches SQL without passing a schema, and all SQL
  is parameterised.
- **Rate limiting** — 20 attempts per 15 minutes on credential endpoints, 10
  signups per hour per address, 300 requests per minute otherwise.
- **CORS** — an explicit origin allow-list, never a reflected origin.
- **Headers** — Helmet with a content security policy, `frame-ancestors: none`,
  and `X-Powered-By` removed.
- **Error responses** — unrecognised errors return a generic message; stack
  traces and SQL are never sent to a client in production.
- **Audit log** — every mutation records actor, action, entity, IP and metadata,
  scoped to the merchant so each tenant can review its own staff and no one
  else's. Member list exports are logged too.
- **CSV injection** — exported cells starting with `= + - @` are prefixed with a
  quote, so a customer who names themselves `=cmd|calc!A1` cannot execute code in
  a merchant's spreadsheet.
- **Secrets** — the server refuses to boot in production if a signing secret is
  missing, shorter than 32 characters, or still set to the development default.
- **API keys** — shown once at creation, stored only as a SHA-256 hash, and
  revocable. A leaked database gives an attacker no usable key.

## Threat model

**Defended against:** a merchant (or their staff) trying to read or modify
another merchant's data through the API; id guessing; token tampering or
re-signing; cross-principal token replay; credential stuffing and password
spraying; refresh token theft; a customer trying to reach another customer's
membership or redeem against a programme they have not joined; a compromised
till key being used to escalate beyond awarding points; SQL and CSV injection.

**Explicitly out of scope for this codebase:** anything at the infrastructure
layer — TLS termination, database encryption at rest, backups, DDoS protection,
and host hardening are deployment concerns, covered in `DEPLOYMENT.md`.

**Not built yet, and would be needed before charging real customers:**

1. **Payment processing.** Plans and entitlements are real; taking money is not
   wired up. Add Stripe (or similar) at
   `POST /api/merchant/account/billing/plan` and have its webhook drive
   `subscription_status`.
2. **Email delivery.** No verification emails, password resets, or receipts. A
   customer signed up at the counter currently gets a random password and has no
   way to set their own.
3. **Two-factor authentication** for owner accounts.
4. **Points expiry.** The `points_expiry_days` setting is stored and surfaced but
   no job enforces it; the ledger has an `expire` entry type ready for one.
5. **GDPR/PDPA tooling.** Customer data export and erasure are legal
   requirements in most markets this would sell into. The append-only ledger
   needs a documented erasure strategy (anonymise the customer record, keep the
   financial entries) before launch.
6. **Formal penetration test.** The isolation tests demonstrate the design
   holds against the attacks we thought to write. That is not the same as an
   adversary who did not write the code.
