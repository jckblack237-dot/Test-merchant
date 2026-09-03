import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { TenantStore } from '../db/tenant';
import { conflict, paymentRequired } from '../lib/errors';
import { addDays, isPast, nowIso } from '../lib/time';

export interface PlanRow {
  code: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  interval: string;
  max_locations: number;
  max_staff: number;
  max_members: number;
  features: string;
  is_public: number;
  sort_order: number;
}

export interface MerchantRow {
  id: string;
  name: string;
  slug: string;
  plan_code: string;
  subscription_status: 'trialing' | 'active' | 'past_due' | 'cancelled';
  trial_ends_at: string | null;
  current_period_end: string | null;
  status: 'active' | 'suspended' | 'cancelled';
  [key: string]: unknown;
}

export function getPlan(code: string, db: Database.Database = getDb()): PlanRow {
  const plan = db.prepare(`SELECT * FROM plans WHERE code = ?`).get(code) as PlanRow | undefined;
  if (!plan) throw conflict(`Unknown plan "${code}".`);
  return plan;
}

export function listPublicPlans(db: Database.Database = getDb()): PlanRow[] {
  return db
    .prepare(`SELECT * FROM plans WHERE is_public = 1 ORDER BY sort_order`)
    .all() as PlanRow[];
}

export function getMerchant(merchantId: string, db: Database.Database = getDb()): MerchantRow {
  const row = db.prepare(`SELECT * FROM merchants WHERE id = ?`).get(merchantId) as
    | MerchantRow
    | undefined;
  if (!row) throw conflict('Merchant not found.');
  return row;
}

export interface SubscriptionState {
  plan: PlanRow;
  status: MerchantRow['subscription_status'];
  /** True when the merchant may perform billable write operations. */
  writable: boolean;
  trialDaysLeft: number | null;
  renewsAt: string | null;
  reason?: string;
}

export function subscriptionState(merchant: MerchantRow, db: Database.Database = getDb()): SubscriptionState {
  const plan = getPlan(merchant.plan_code, db);
  const trialDaysLeft = merchant.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(merchant.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : null;

  if (merchant.subscription_status === 'cancelled') {
    return {
      plan, status: 'cancelled', writable: false, trialDaysLeft, renewsAt: null,
      reason: 'Your subscription has been cancelled. Reactivate a plan to keep running your programme.',
    };
  }
  if (merchant.subscription_status === 'trialing' && isPast(merchant.trial_ends_at)) {
    return {
      plan, status: 'past_due', writable: false, trialDaysLeft: 0, renewsAt: null,
      reason: 'Your free trial has ended. Choose a plan to continue.',
    };
  }
  if (merchant.subscription_status === 'past_due') {
    return {
      plan, status: 'past_due', writable: false, trialDaysLeft, renewsAt: merchant.current_period_end,
      reason: 'We could not take your last payment. Update your billing details to continue.',
    };
  }
  return {
    plan,
    status: merchant.subscription_status,
    writable: true,
    trialDaysLeft,
    renewsAt: merchant.current_period_end,
  };
}

export type Resource = 'locations' | 'staff' | 'members';

const LIMIT_COLUMN: Record<Resource, keyof PlanRow> = {
  locations: 'max_locations',
  staff: 'max_staff',
  members: 'max_members',
};

export function usageFor(store: TenantStore): Record<Resource, number> {
  return {
    locations: store.count('locations'),
    staff: store.count('merchant_users', `status = 'active'`),
    members: store.count('memberships'),
  };
}

/**
 * Throws 402 when adding one more `resource` would exceed the merchant's plan.
 * This is what turns the plan catalogue into an actual paywall.
 */
export function assertCapacity(store: TenantStore, resource: Resource, plan: PlanRow): void {
  const limit = plan[LIMIT_COLUMN[resource]] as number;
  if (limit < 0) return; // unlimited
  const current = usageFor(store)[resource];
  if (current >= limit) {
    throw paymentRequired(
      `Your ${plan.name} plan includes ${limit} ${resource}. Upgrade to add more.`,
      { resource, limit, current, plan: plan.code },
    );
  }
}

export function changePlan(merchantId: string, planCode: string, db: Database.Database = getDb()): MerchantRow {
  const plan = getPlan(planCode, db);
  const merchant = getMerchant(merchantId, db);
  const store = new TenantStore(merchantId, db);
  const usage = usageFor(store);

  // Downgrades must not silently orphan data the new plan cannot hold.
  for (const resource of ['locations', 'staff', 'members'] as Resource[]) {
    const limit = plan[LIMIT_COLUMN[resource]] as number;
    if (limit >= 0 && usage[resource] > limit) {
      throw conflict(
        `You currently have ${usage[resource]} ${resource}, but ${plan.name} allows ${limit}. ` +
          `Remove some before downgrading.`,
        { resource, limit, current: usage[resource] },
      );
    }
  }

  db.prepare(
    `UPDATE merchants
     SET plan_code = ?, subscription_status = 'active', current_period_end = ?,
         trial_ends_at = NULL, cancelled_at = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(planCode, addDays(new Date(), 30).toISOString(), nowIso(), merchantId);

  return getMerchant(merchantId, db);
}

export function cancelSubscription(merchantId: string, db: Database.Database = getDb()): MerchantRow {
  db.prepare(
    `UPDATE merchants SET subscription_status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`,
  ).run(nowIso(), nowIso(), merchantId);
  return getMerchant(merchantId, db);
}
