# API reference

Base URL `http://localhost:4000/api`. All requests and responses are JSON.

Authenticate with `Authorization: Bearer <accessToken>`. Access tokens last 30
minutes; exchange the refresh token for a new pair at the `/refresh` endpoint
for your principal type.

Errors follow one shape:

```json
{ "error": { "code": "not_found", "message": "Member not found.", "details": null } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `validation_error`, `bad_request` | The payload was rejected. `details` lists the offending fields. |
| 401 | `unauthorized` | Missing, expired or invalid credentials. |
| 402 | `subscription_required` | Plan limit reached, or the subscription has lapsed. |
| 403 | `forbidden` | Authenticated, but your role or key type is not allowed. |
| 404 | `not_found` | No such record **for you**. Also returned for another merchant's records. |
| 409 | `conflict` | Business rule violation — insufficient points, duplicate email, sold out. |
| 429 | `rate_limited` | Slow down. |

---

## Public

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness probe. |
| `GET` | `/plans` | Subscription catalogue for the pricing page. |
| `GET` | `/merchants?q=&category=` | Directory of merchants that opted in. |
| `GET` | `/merchants/:slug` | One merchant's storefront: locations, menu, rewards, tiers. |

## Authentication

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/merchant/signup` | Create a merchant, its owner, starter tiers and rewards. Starts a trial. |
| `POST` | `/auth/merchant/login` | Staff sign-in. |
| `POST` | `/auth/merchant/refresh` | Rotate the refresh token. |
| `POST` | `/auth/merchant/logout` | Revoke one refresh token. |
| `GET` | `/auth/merchant/me` | Current user, merchant and subscription state. |
| `POST` | `/auth/merchant/change-password` | Requires the current password. |
| `POST` | `/auth/customer/signup` · `/login` · `/refresh` · `/logout` | Customer equivalents. |
| `GET` | `/auth/customer/me` | Current customer profile. |

```bash
curl -X POST http://localhost:4000/api/auth/merchant/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@zuzcoffee.test","password":"demo12345"}'
```

## Customer app

All require a customer token. A customer can only ever address their own
memberships — the API takes their identity from the token and never accepts a
membership id from the client.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/customer/wallet` | Every programme they belong to, with balances and tier progress. |
| `POST` | `/customer/merchants/:merchantId/join` | Join a programme. Idempotent. |
| `GET` | `/customer/merchants/:merchantId/membership` | One card in detail. |
| `GET` | `/customer/merchants/:merchantId/qr` | Short-lived scannable token (120s). |
| `GET` | `/customer/merchants/:merchantId/catalog` | That merchant's menu, shops, rewards, tiers. |
| `GET` | `/customer/merchants/:merchantId/activity?limit=` | Their points history there. |
| `POST` | `/customer/merchants/:merchantId/redeem` | Spend points on a reward. |
| `GET` | `/customer/redemptions` | Reward codes across all programmes. |
| `PATCH` | `/customer/profile` | Update name, email, phone, marketing opt-in. |

## Merchant CRM

All require a merchant token, and all are scoped to that token's merchant.
The **Role** column is the minimum required.

### Dashboard and members

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/merchant/dashboard?days=30` | staff | KPIs, daily series, top members, per-location revenue, tier mix, plan usage. |
| `GET` | `/merchant/members?q=&sort=&tierId=&status=&limit=&offset=` | staff | Search and list. Sorts: `recent`, `points`, `lifetime`, `spend`, `name`, `joined`. |
| `GET` | `/merchant/members/:id` | staff | Full profile with ledger and redemptions. |
| `POST` | `/merchant/members` | staff | Sign a walk-in up at the counter. |
| `PATCH` | `/merchant/members/:id` | manager | Private notes, tags, block/unblock. |
| `GET` | `/merchant/members/export/csv` | manager | Full member list as CSV. |

### Points

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/merchant/points/lookup` | staff | Resolve a scanned code, member number or email. |
| `POST` | `/merchant/points/preview` | staff | Dry run of the earn rules — no data changes. |
| `POST` | `/merchant/points/award` | staff | Award points for a purchase. |
| `POST` | `/merchant/points/adjust` | manager | Manual correction. Reason required, always audited. |
| `GET` | `/merchant/points/transactions?limit=&offset=&type=` | staff | The whole programme's ledger. |
| `GET` | `/merchant/points/redemptions?status=` | staff | Redemption queue. |
| `GET` | `/merchant/points/redemptions/code/:code` | staff | Look a code up at the counter. |
| `POST` | `/merchant/points/redemptions/:id/fulfil` | staff | Mark a reward handed over. |
| `POST` | `/merchant/points/redemptions/:id/cancel` | manager | Cancel and return the points. |

### Catalogue

Each of `locations`, `products`, `rewards`, `tiers` and `campaigns` supports the
same five operations at `/merchant/catalog/<resource>`:

| Method | Path | Role |
|---|---|---|
| `GET` | `/merchant/catalog/:resource` | staff |
| `GET` | `/merchant/catalog/:resource/:id` | staff |
| `POST` | `/merchant/catalog/:resource` | manager (owner for tiers) |
| `PATCH` | `/merchant/catalog/:resource/:id` | manager (owner for tiers) |
| `DELETE` | `/merchant/catalog/:resource/:id` | manager (owner for tiers) |

A reward that has ever been redeemed cannot be deleted — deactivate it instead,
so customers keep their history.

### Team, billing and account

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/merchant/team` | manager | Staff accounts. |
| `POST` · `PATCH` · `DELETE` | `/merchant/team[/:id]` | owner | Manage staff. Changes revoke their live sessions. |
| `GET` · `POST` | `/merchant/api-keys` | owner | List and create POS keys. The secret is returned once. |
| `POST` | `/merchant/api-keys/:id/revoke` | owner | Kill a key immediately. |
| `GET` · `PATCH` | `/merchant/account/settings` | staff · owner | Branding and earn rules. |
| `GET` | `/merchant/account/billing` | owner | Plan, usage against limits, available plans. |
| `POST` | `/merchant/account/billing/plan` | owner | Change plan. |
| `POST` | `/merchant/account/billing/cancel` | owner | Cancel. Reads stay open. |
| `GET` | `/merchant/account/audit?limit=&offset=&action=` | manager | This merchant's audit log. |

---

## Connecting a point-of-sale system

Create a key in the CRM under **Team & keys**, then use it as a bearer token.
A key can award points and look members up — it cannot read the team, change
settings, adjust balances or touch billing.

```bash
KEY="llk_your_key_here"

# 1. Resolve the customer from whatever the till captured.
curl -X POST http://localhost:4000/api/merchant/points/lookup \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"qrToken":"mem_gddvg4qn8z02tvxa.tkshx2.LSJd22WlizjDeDKQ"}'
# Also accepts {"memberNumber":"047-300"} or {"email":"grace@example.com"}

# 2. Award the points, passing your order id as the reference.
curl -X POST http://localhost:4000/api/merchant/points/award \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{
        "membershipId": "mem_gddvg4qn8z02tvxa",
        "amountCents": 1250,
        "locationId": "loc_pwvjwy60g333bjvp",
        "reference": "order-88213"
      }'
```

**Always send a `reference`.** It makes the award idempotent: if the till times
out and retries, the second call returns the original transaction instead of
paying the customer twice. Use your own order id.

The response tells you what to show on the receipt:

```json
{
  "transaction": { "id": "txn_…", "pointsDelta": 24, "balanceAfter": 498 },
  "breakdown": {
    "base": 12,
    "tierMultiplier": 1,
    "campaignMultiplier": 2,
    "total": 24,
    "appliedCampaigns": [{ "id": "cmp_…", "name": "Double Point Tuesdays" }]
  },
  "member": { "name": "Ivy Tan", "pointsBalance": 498 },
  "tierUpgradedTo": null
}
```

`tierUpgradedTo` is non-null when that purchase promoted the customer — worth
printing on the receipt, or telling them at the counter.
