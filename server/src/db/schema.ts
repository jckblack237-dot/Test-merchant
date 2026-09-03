/**
 * LoyaltyLoop database schema.
 *
 * Tenancy model
 * -------------
 * `merchants` is the tenant root. Every table that stores merchant-owned data
 * carries a non-null `merchant_id` and is listed in TENANT_TABLES (tenant.ts).
 * Access to those tables goes exclusively through the tenant-scoped data layer,
 * which appends `merchant_id = ?` to every statement it builds. Tables without
 * a `merchant_id` are either platform-global catalogues (`plans`) or identity
 * records that deliberately span merchants (`customers`, `refresh_tokens`).
 *
 * `customers` is intentionally global: one person holds one login and can be a
 * member of many merchants. The merchant-visible slice of that person lives in
 * `memberships`, which IS tenant-scoped — so Merchant A sees its own membership
 * row and never learns that the same person also shops at Merchant B.
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Platform layer (owned by the SaaS operator, not by any merchant)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plans (
  code                TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  price_cents         INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  interval            TEXT NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year')),
  max_locations       INTEGER NOT NULL DEFAULT 1,
  max_staff           INTEGER NOT NULL DEFAULT 3,
  max_members         INTEGER NOT NULL DEFAULT 500,
  features            TEXT NOT NULL DEFAULT '[]',
  is_public           INTEGER NOT NULL DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS platform_admins (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchants (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  tagline             TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL DEFAULT '',
  category            TEXT NOT NULL DEFAULT 'cafe',
  logo_url            TEXT,
  cover_url           TEXT,
  brand_color         TEXT NOT NULL DEFAULT '#0F766E',
  currency            TEXT NOT NULL DEFAULT 'USD',
  country             TEXT NOT NULL DEFAULT 'US',
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','cancelled')),
  -- Loyalty programme configuration
  points_per_currency REAL NOT NULL DEFAULT 1,
  signup_bonus_points INTEGER NOT NULL DEFAULT 0,
  points_expiry_days  INTEGER,
  redeem_needs_staff  INTEGER NOT NULL DEFAULT 1,
  is_listed           INTEGER NOT NULL DEFAULT 1,
  -- SaaS subscription state
  plan_code           TEXT NOT NULL DEFAULT 'starter' REFERENCES plans(code),
  subscription_status TEXT NOT NULL DEFAULT 'trialing'
                        CHECK (subscription_status IN ('trialing','active','past_due','cancelled')),
  trial_ends_at       TEXT,
  current_period_end  TEXT,
  cancelled_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merchants_listed ON merchants(is_listed, status);

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

-- Staff who sign in to the merchant CRM. Scoped to exactly one merchant.
CREATE TABLE IF NOT EXISTS merchant_users (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  name                TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','staff')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  last_login_at       TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merchant_users_merchant ON merchant_users(merchant_id, status);

-- End customers. One global identity that can belong to many loyalty programmes.
CREATE TABLE IF NOT EXISTS customers (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  phone               TEXT,
  password_hash       TEXT NOT NULL,
  name                TEXT NOT NULL,
  avatar_url          TEXT,
  marketing_opt_in    INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  last_login_at       TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Rotating refresh tokens for all three principal types. Stores only a hash.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                  TEXT PRIMARY KEY,
  token_hash          TEXT NOT NULL UNIQUE,
  principal_type      TEXT NOT NULL CHECK (principal_type IN ('merchant_user','customer','platform_admin')),
  principal_id        TEXT NOT NULL,
  merchant_id         TEXT,
  expires_at          TEXT NOT NULL,
  revoked_at          TEXT,
  replaced_by         TEXT,
  user_agent          TEXT,
  ip                  TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_principal ON refresh_tokens(principal_type, principal_id);

-- ---------------------------------------------------------------------------
-- Merchant-owned data. Every table below is tenant scoped.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS locations (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  address_line1       TEXT NOT NULL DEFAULT '',
  city                TEXT NOT NULL DEFAULT '',
  region              TEXT NOT NULL DEFAULT '',
  postcode            TEXT NOT NULL DEFAULT '',
  country             TEXT NOT NULL DEFAULT '',
  lat                 REAL,
  lng                 REAL,
  phone               TEXT,
  opening_hours       TEXT NOT NULL DEFAULT '',
  image_url           TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_locations_merchant ON locations(merchant_id, is_active);

CREATE TABLE IF NOT EXISTS products (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id         TEXT REFERENCES locations(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  category            TEXT NOT NULL DEFAULT 'General',
  price_cents         INTEGER NOT NULL DEFAULT 0,
  image_url           TEXT,
  points_override     INTEGER,
  is_active           INTEGER NOT NULL DEFAULT 1,
  is_featured         INTEGER NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS tiers (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  min_lifetime_points INTEGER NOT NULL DEFAULT 0,
  multiplier          REAL NOT NULL DEFAULT 1,
  color               TEXT NOT NULL DEFAULT '#94A3B8',
  perks               TEXT NOT NULL DEFAULT '[]',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tiers_merchant ON tiers(merchant_id, min_lifetime_points);

CREATE TABLE IF NOT EXISTS memberships (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id         TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tier_id             TEXT REFERENCES tiers(id) ON DELETE SET NULL,
  member_number       TEXT NOT NULL,
  points_balance      INTEGER NOT NULL DEFAULT 0,
  lifetime_points     INTEGER NOT NULL DEFAULT 0,
  points_redeemed     INTEGER NOT NULL DEFAULT 0,
  visits              INTEGER NOT NULL DEFAULT 0,
  total_spend_cents   INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  notes               TEXT NOT NULL DEFAULT '',
  tags                TEXT NOT NULL DEFAULT '[]',
  joined_at           TEXT NOT NULL,
  last_activity_at    TEXT,
  updated_at          TEXT NOT NULL,
  UNIQUE (merchant_id, customer_id),
  UNIQUE (merchant_id, member_number)
);

CREATE INDEX IF NOT EXISTS idx_memberships_merchant ON memberships(merchant_id, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_memberships_customer ON memberships(customer_id);

CREATE TABLE IF NOT EXISTS rewards (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  points_cost         INTEGER NOT NULL,
  image_url           TEXT,
  category            TEXT NOT NULL DEFAULT 'Drinks',
  stock               INTEGER NOT NULL DEFAULT -1,
  per_member_limit    INTEGER NOT NULL DEFAULT -1,
  is_active           INTEGER NOT NULL DEFAULT 1,
  starts_at           TEXT,
  ends_at             TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rewards_merchant ON rewards(merchant_id, is_active, points_cost);

CREATE TABLE IF NOT EXISTS redemptions (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  membership_id       TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  reward_id           TEXT NOT NULL REFERENCES rewards(id) ON DELETE RESTRICT,
  points_spent        INTEGER NOT NULL,
  code                TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','fulfilled','cancelled','expired')),
  location_id         TEXT REFERENCES locations(id) ON DELETE SET NULL,
  fulfilled_by        TEXT REFERENCES merchant_users(id) ON DELETE SET NULL,
  fulfilled_at        TEXT,
  expires_at          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_redemptions_merchant ON redemptions(merchant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_redemptions_membership ON redemptions(membership_id, created_at);

-- Append-only points ledger. Never updated in place; membership balances are a
-- cached projection of this table maintained inside the same DB transaction.
CREATE TABLE IF NOT EXISTS transactions (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  membership_id       TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  type                TEXT NOT NULL CHECK (type IN ('earn','redeem','adjust','signup_bonus','refund','expire')),
  points_delta        INTEGER NOT NULL,
  balance_after       INTEGER NOT NULL,
  amount_cents        INTEGER NOT NULL DEFAULT 0,
  location_id         TEXT REFERENCES locations(id) ON DELETE SET NULL,
  staff_user_id       TEXT REFERENCES merchant_users(id) ON DELETE SET NULL,
  redemption_id       TEXT REFERENCES redemptions(id) ON DELETE SET NULL,
  source              TEXT NOT NULL DEFAULT 'crm' CHECK (source IN ('crm','pos','app','import','system')),
  reference           TEXT,
  note                TEXT NOT NULL DEFAULT '',
  items               TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_membership ON transactions(membership_id, created_at);
-- Idempotency: a POS may safely retry an award with the same reference.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_reference
  ON transactions(merchant_id, reference) WHERE reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaigns (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  type                TEXT NOT NULL DEFAULT 'multiplier' CHECK (type IN ('multiplier','bonus')),
  multiplier          REAL NOT NULL DEFAULT 1,
  bonus_points        INTEGER NOT NULL DEFAULT 0,
  min_spend_cents     INTEGER NOT NULL DEFAULT 0,
  location_id         TEXT REFERENCES locations(id) ON DELETE CASCADE,
  starts_at           TEXT,
  ends_at             TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_merchant ON campaigns(merchant_id, is_active);

CREATE TABLE IF NOT EXISTS api_keys (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  prefix              TEXT NOT NULL,
  key_hash            TEXT NOT NULL,
  scopes              TEXT NOT NULL DEFAULT '["points:write"]',
  created_by          TEXT REFERENCES merchant_users(id) ON DELETE SET NULL,
  last_used_at        TEXT,
  revoked_at          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_merchant ON api_keys(merchant_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);

-- Tamper-evident record of who touched what. Merchant-scoped so each tenant
-- can audit its own staff without ever seeing another tenant's activity.
CREATE TABLE IF NOT EXISTS audit_logs (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  actor_type          TEXT NOT NULL,
  actor_id            TEXT,
  actor_label         TEXT NOT NULL DEFAULT '',
  action              TEXT NOT NULL,
  entity_type         TEXT NOT NULL DEFAULT '',
  entity_id           TEXT,
  ip                  TEXT,
  user_agent          TEXT,
  meta                TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_merchant ON audit_logs(merchant_id, created_at);

-- Security events that are not tied to a tenant (failed logins, cross-tenant
-- access attempts before a tenant is resolved). Operator-visible only.
CREATE TABLE IF NOT EXISTS security_events (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL,
  principal_type      TEXT,
  principal_id        TEXT,
  merchant_id         TEXT,
  ip                  TEXT,
  detail              TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);
`;
