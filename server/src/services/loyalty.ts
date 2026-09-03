import type { TenantStore } from '../db/tenant';
import { badRequest, conflict, notFound } from '../lib/errors';
import { newId, newMemberNumber, newRedemptionCode } from '../lib/ids';
import { addDays, nowIso } from '../lib/time';

export interface MembershipRow {
  id: string;
  merchant_id: string;
  customer_id: string;
  tier_id: string | null;
  member_number: string;
  points_balance: number;
  lifetime_points: number;
  points_redeemed: number;
  visits: number;
  total_spend_cents: number;
  status: 'active' | 'blocked';
  notes: string;
  tags: string;
  joined_at: string;
  last_activity_at: string | null;
  updated_at: string;
}

export interface TierRow {
  id: string;
  name: string;
  min_lifetime_points: number;
  multiplier: number;
  color: string;
  perks: string;
  sort_order: number;
}

export interface MerchantSettings {
  points_per_currency: number;
  signup_bonus_points: number;
  points_expiry_days: number | null;
  redeem_needs_staff: number;
}

export interface EarnInput {
  membershipId: string;
  amountCents: number;
  locationId?: string | null;
  productIds?: string[];
  staffUserId?: string | null;
  source?: 'crm' | 'pos' | 'app' | 'import' | 'system';
  reference?: string | null;
  note?: string;
}

export interface LedgerEntry {
  id: string;
  type: string;
  points_delta: number;
  balance_after: number;
  amount_cents: number;
  created_at: string;
  note: string;
  [key: string]: unknown;
}

/** Tier a membership qualifies for at a given lifetime points total. */
export function tierForPoints(tiers: TierRow[], lifetimePoints: number): TierRow | null {
  const eligible = tiers
    .filter((tier) => lifetimePoints >= tier.min_lifetime_points)
    .sort((a, b) => b.min_lifetime_points - a.min_lifetime_points);
  return eligible[0] ?? null;
}

export function nextTier(tiers: TierRow[], lifetimePoints: number): TierRow | null {
  const upcoming = tiers
    .filter((tier) => lifetimePoints < tier.min_lifetime_points)
    .sort((a, b) => a.min_lifetime_points - b.min_lifetime_points);
  return upcoming[0] ?? null;
}

interface ActiveCampaign {
  id: string;
  name: string;
  type: 'multiplier' | 'bonus';
  multiplier: number;
  bonus_points: number;
  min_spend_cents: number;
  location_id: string | null;
}

function activeCampaigns(store: TenantStore, locationId: string | null | undefined): ActiveCampaign[] {
  const now = nowIso();
  return store.list<ActiveCampaign & Record<string, unknown>>('campaigns', {
    where: `is_active = 1
            AND (starts_at IS NULL OR starts_at <= @now)
            AND (ends_at IS NULL OR ends_at >= @now)
            AND (location_id IS NULL OR location_id = @locationId)`,
    params: { now, locationId: locationId ?? null },
  }) as ActiveCampaign[];
}

export interface PointsBreakdown {
  base: number;
  tierMultiplier: number;
  campaignMultiplier: number;
  campaignBonus: number;
  productBonus: number;
  total: number;
  appliedCampaigns: { id: string; name: string }[];
}

/**
 * Works out how many points a purchase earns.
 *
 * base            = spend x the merchant's points-per-currency rate
 * product bonus   = per-product overrides replace the base rate for those items
 * tier multiplier = loyalty tier the member currently sits in
 * campaign        = time-boxed multipliers and flat bonuses, stacked additively
 *
 * Kept pure so it can be unit tested and previewed in the CRM before awarding.
 */
export function calculatePoints(args: {
  amountCents: number;
  settings: MerchantSettings;
  tier: TierRow | null;
  campaigns: ActiveCampaign[];
  productOverrides?: number[];
}): PointsBreakdown {
  const { amountCents, settings, tier, campaigns, productOverrides = [] } = args;
  if (amountCents < 0) throw badRequest('Amount cannot be negative.');

  const productBonus = productOverrides.reduce((sum, value) => sum + Math.max(0, value), 0);
  const base = productOverrides.length > 0
    ? 0
    : Math.floor((amountCents / 100) * settings.points_per_currency);

  const tierMultiplier = tier?.multiplier ?? 1;

  const applicable = campaigns.filter((c) => amountCents >= c.min_spend_cents);
  const campaignMultiplier = applicable
    .filter((c) => c.type === 'multiplier')
    .reduce((acc, c) => acc * (c.multiplier > 0 ? c.multiplier : 1), 1);
  const campaignBonus = applicable
    .filter((c) => c.type === 'bonus')
    .reduce((sum, c) => sum + c.bonus_points, 0);

  const subtotal = base + productBonus;
  const total = Math.max(
    0,
    Math.floor(subtotal * tierMultiplier * campaignMultiplier) + campaignBonus,
  );

  return {
    base,
    tierMultiplier,
    campaignMultiplier,
    campaignBonus,
    productBonus,
    total,
    appliedCampaigns: applicable.map((c) => ({ id: c.id, name: c.name })),
  };
}

function loadSettings(store: TenantStore): MerchantSettings {
  const row = store.handle
    .prepare(
      `SELECT points_per_currency, signup_bonus_points, points_expiry_days, redeem_needs_staff
       FROM merchants WHERE id = ?`,
    )
    .get(store.merchantId) as MerchantSettings | undefined;
  if (!row) throw notFound('Merchant not found.');
  return row;
}

export function loadTiers(store: TenantStore): TierRow[] {
  return store.list<TierRow & Record<string, unknown>>('tiers', {
    orderBy: 'min_lifetime_points ASC',
  }) as TierRow[];
}

/** Recomputes and persists the tier a membership belongs in. */
function syncTier(store: TenantStore, membership: MembershipRow): string | null {
  const tiers = loadTiers(store);
  const tier = tierForPoints(tiers, membership.lifetime_points);
  const tierId = tier?.id ?? null;
  if (tierId !== membership.tier_id) {
    store.update('memberships', membership.id, { tier_id: tierId, updated_at: nowIso() });
  }
  return tierId;
}

export interface AwardResult {
  transaction: LedgerEntry;
  membership: MembershipRow;
  breakdown: PointsBreakdown;
  tierChangedTo: TierRow | null;
}

/**
 * Awards points for a purchase.
 *
 * Everything runs in one SQLite transaction: the ledger row, the cached balance
 * on the membership and the tier recalculation either all land or none do, so a
 * balance can never drift from the ledger that explains it.
 */
export function awardPoints(store: TenantStore, input: EarnInput): AwardResult {
  return store.transaction(() => {
    const membership = store.findOrFail<MembershipRow & Record<string, unknown>>(
      'memberships',
      input.membershipId,
      'Member',
    ) as MembershipRow;

    if (membership.status === 'blocked') {
      throw conflict('This member is blocked and cannot earn points.');
    }

    if (input.reference) {
      const existing = store.findBy<LedgerEntry & Record<string, unknown>>(
        'transactions',
        'reference = @reference',
        { reference: input.reference },
      );
      // Idempotent replay: a POS that retries a timed-out request gets the
      // original result back instead of double-awarding the customer.
      if (existing) {
        return {
          transaction: existing as LedgerEntry,
          membership,
          breakdown: {
            base: 0, tierMultiplier: 1, campaignMultiplier: 1, campaignBonus: 0,
            productBonus: 0, total: (existing as LedgerEntry).points_delta, appliedCampaigns: [],
          },
          tierChangedTo: null,
        };
      }
    }

    const settings = loadSettings(store);
    const tiers = loadTiers(store);
    const currentTier = tierForPoints(tiers, membership.lifetime_points);

    let productOverrides: number[] = [];
    let items: { id: string; name: string; price_cents: number }[] = [];
    if (input.productIds?.length) {
      const placeholders = input.productIds.map((_, i) => `@p${i}`).join(', ');
      const params = Object.fromEntries(input.productIds.map((id, i) => [`p${i}`, id]));
      const rows = store.list<{ id: string; name: string; price_cents: number; points_override: number | null }>(
        'products',
        { where: `id IN (${placeholders})`, params },
      );
      items = rows.map((r) => ({ id: r.id, name: r.name, price_cents: r.price_cents }));
      if (rows.some((r) => r.points_override !== null)) {
        productOverrides = rows.map((r) =>
          r.points_override ?? Math.floor((r.price_cents / 100) * settings.points_per_currency),
        );
      }
    }

    if (input.locationId) {
      store.findOrFail('locations', input.locationId, 'Location');
    }

    const breakdown = calculatePoints({
      amountCents: input.amountCents,
      settings,
      tier: currentTier,
      campaigns: activeCampaigns(store, input.locationId),
      productOverrides,
    });

    const balanceAfter = membership.points_balance + breakdown.total;
    const now = nowIso();

    const transaction = store.insert<LedgerEntry & Record<string, unknown>>('transactions', {
      id: newId('txn'),
      membership_id: membership.id,
      type: 'earn',
      points_delta: breakdown.total,
      balance_after: balanceAfter,
      amount_cents: input.amountCents,
      location_id: input.locationId ?? null,
      staff_user_id: input.staffUserId ?? null,
      redemption_id: null,
      source: input.source ?? 'crm',
      reference: input.reference ?? null,
      note: input.note ?? '',
      items: JSON.stringify(items),
      created_at: now,
    }) as LedgerEntry;

    const updated = store.update<MembershipRow & Record<string, unknown>>('memberships', membership.id, {
      points_balance: balanceAfter,
      lifetime_points: membership.lifetime_points + breakdown.total,
      visits: membership.visits + 1,
      total_spend_cents: membership.total_spend_cents + input.amountCents,
      last_activity_at: now,
      updated_at: now,
    }) as MembershipRow;

    const previousTierId = membership.tier_id;
    const newTierId = syncTier(store, updated);
    const tierChangedTo =
      newTierId && newTierId !== previousTierId ? tiers.find((t) => t.id === newTierId) ?? null : null;

    return { transaction, membership: { ...updated, tier_id: newTierId }, breakdown, tierChangedTo };
  });
}

export interface AdjustInput {
  membershipId: string;
  points: number;
  note: string;
  staffUserId?: string | null;
}

/** Manual correction by staff. Signed, always audited, never silently applied. */
export function adjustPoints(store: TenantStore, input: AdjustInput): AwardResult {
  return store.transaction(() => {
    const membership = store.findOrFail<MembershipRow & Record<string, unknown>>(
      'memberships', input.membershipId, 'Member',
    ) as MembershipRow;

    if (!Number.isInteger(input.points) || input.points === 0) {
      throw badRequest('Adjustment must be a non-zero whole number of points.');
    }
    const balanceAfter = membership.points_balance + input.points;
    if (balanceAfter < 0) {
      throw badRequest(
        `That would take the balance to ${balanceAfter}. This member only has ${membership.points_balance} points.`,
      );
    }

    const now = nowIso();
    const transaction = store.insert<LedgerEntry & Record<string, unknown>>('transactions', {
      id: newId('txn'),
      membership_id: membership.id,
      type: 'adjust',
      points_delta: input.points,
      balance_after: balanceAfter,
      amount_cents: 0,
      location_id: null,
      staff_user_id: input.staffUserId ?? null,
      redemption_id: null,
      source: 'crm',
      reference: null,
      note: input.note,
      items: '[]',
      created_at: now,
    }) as LedgerEntry;

    const updated = store.update<MembershipRow & Record<string, unknown>>('memberships', membership.id, {
      points_balance: balanceAfter,
      // A positive correction counts toward lifetime standing; clawing points
      // back does not lower a tier the customer already earned.
      lifetime_points: membership.lifetime_points + Math.max(0, input.points),
      last_activity_at: now,
      updated_at: now,
    }) as MembershipRow;

    const tiers = loadTiers(store);
    const newTierId = syncTier(store, updated);
    return {
      transaction,
      membership: { ...updated, tier_id: newTierId },
      breakdown: {
        base: input.points, tierMultiplier: 1, campaignMultiplier: 1, campaignBonus: 0,
        productBonus: 0, total: input.points, appliedCampaigns: [],
      },
      tierChangedTo: newTierId ? tiers.find((t) => t.id === newTierId) ?? null : null,
    };
  });
}

export interface RewardRow {
  id: string;
  name: string;
  description: string;
  points_cost: number;
  stock: number;
  per_member_limit: number;
  is_active: number;
  starts_at: string | null;
  ends_at: string | null;
  [key: string]: unknown;
}

export interface RedemptionResult {
  redemption: Record<string, unknown>;
  membership: MembershipRow;
  transaction: LedgerEntry;
}

/**
 * Spends points on a catalogue reward and issues a code for staff to scan.
 * Balance check, stock decrement and ledger entry share one transaction, so two
 * simultaneous redemptions can never both pass the balance check.
 */
export function redeemReward(
  store: TenantStore,
  args: { membershipId: string; rewardId: string; locationId?: string | null },
): RedemptionResult {
  return store.transaction(() => {
    const membership = store.findOrFail<MembershipRow & Record<string, unknown>>(
      'memberships', args.membershipId, 'Member',
    ) as MembershipRow;
    if (membership.status === 'blocked') throw conflict('This member is blocked.');

    const reward = store.findOrFail<RewardRow>('rewards', args.rewardId, 'Reward');
    const now = nowIso();

    if (!reward.is_active) throw conflict('This reward is not currently available.');
    if (reward.starts_at && reward.starts_at > now) throw conflict('This reward is not available yet.');
    if (reward.ends_at && reward.ends_at < now) throw conflict('This reward has expired.');
    if (reward.stock === 0) throw conflict('This reward is out of stock.');

    if (reward.per_member_limit >= 0) {
      const used = store.count(
        'redemptions',
        `membership_id = @membershipId AND reward_id = @rewardId AND status != 'cancelled'`,
        { membershipId: membership.id, rewardId: reward.id },
      );
      if (used >= reward.per_member_limit) {
        throw conflict(`This reward is limited to ${reward.per_member_limit} per member.`);
      }
    }

    if (membership.points_balance < reward.points_cost) {
      throw conflict(
        `Not enough points. This reward costs ${reward.points_cost} and the balance is ${membership.points_balance}.`,
        { required: reward.points_cost, available: membership.points_balance },
      );
    }

    const redemption = store.insert('redemptions', {
      id: newId('red'),
      membership_id: membership.id,
      reward_id: reward.id,
      points_spent: reward.points_cost,
      code: newRedemptionCode(),
      status: 'pending',
      location_id: args.locationId ?? null,
      fulfilled_by: null,
      fulfilled_at: null,
      expires_at: addDays(new Date(), 30).toISOString(),
      created_at: now,
      updated_at: now,
    });

    const balanceAfter = membership.points_balance - reward.points_cost;
    const transaction = store.insert<LedgerEntry & Record<string, unknown>>('transactions', {
      id: newId('txn'),
      membership_id: membership.id,
      type: 'redeem',
      points_delta: -reward.points_cost,
      balance_after: balanceAfter,
      amount_cents: 0,
      location_id: args.locationId ?? null,
      staff_user_id: null,
      redemption_id: String(redemption.id),
      source: 'app',
      reference: null,
      note: `Redeemed: ${reward.name}`,
      items: '[]',
      created_at: now,
    }) as LedgerEntry;

    if (reward.stock > 0) {
      store.update('rewards', reward.id, { stock: reward.stock - 1, updated_at: now });
    }

    const updated = store.update<MembershipRow & Record<string, unknown>>('memberships', membership.id, {
      points_balance: balanceAfter,
      points_redeemed: membership.points_redeemed + reward.points_cost,
      last_activity_at: now,
      updated_at: now,
    }) as MembershipRow;

    return { redemption, membership: updated, transaction };
  });
}

/** Staff marks a redemption as handed over. */
export function fulfilRedemption(
  store: TenantStore,
  redemptionId: string,
  staffUserId: string | null,
  locationId?: string | null,
): Record<string, unknown> {
  return store.transaction(() => {
    const redemption = store.findOrFail<{ status: string; [k: string]: unknown }>(
      'redemptions', redemptionId, 'Redemption',
    );
    if (redemption.status === 'fulfilled') throw conflict('This reward has already been collected.');
    if (redemption.status === 'cancelled') throw conflict('This redemption was cancelled.');
    if (redemption.expires_at && String(redemption.expires_at) < nowIso()) {
      store.update('redemptions', redemptionId, { status: 'expired', updated_at: nowIso() });
      throw conflict('This redemption code has expired.');
    }
    return store.update('redemptions', redemptionId, {
      status: 'fulfilled',
      fulfilled_by: staffUserId,
      fulfilled_at: nowIso(),
      ...(locationId ? { location_id: locationId } : {}),
      updated_at: nowIso(),
    });
  });
}

/** Cancels a pending redemption and returns the points to the member. */
export function cancelRedemption(store: TenantStore, redemptionId: string, reason: string): void {
  store.transaction(() => {
    const redemption = store.findOrFail<{
      status: string; membership_id: string; points_spent: number; [k: string]: unknown;
    }>('redemptions', redemptionId, 'Redemption');
    if (redemption.status !== 'pending') {
      throw conflict('Only a pending redemption can be cancelled.');
    }
    const membership = store.findOrFail<MembershipRow & Record<string, unknown>>(
      'memberships', redemption.membership_id, 'Member',
    ) as MembershipRow;
    const now = nowIso();
    const balanceAfter = membership.points_balance + redemption.points_spent;

    store.insert('transactions', {
      id: newId('txn'),
      membership_id: membership.id,
      type: 'refund',
      points_delta: redemption.points_spent,
      balance_after: balanceAfter,
      amount_cents: 0,
      location_id: null,
      staff_user_id: null,
      redemption_id: redemptionId,
      source: 'crm',
      reference: null,
      note: reason || 'Redemption cancelled',
      items: '[]',
      created_at: now,
    });

    store.update('memberships', membership.id, {
      points_balance: balanceAfter,
      points_redeemed: Math.max(0, membership.points_redeemed - redemption.points_spent),
      updated_at: now,
    });
    store.update('redemptions', redemptionId, { status: 'cancelled', updated_at: now });
  });
}

/** Creates a membership, applying the merchant's signup bonus if configured. */
export function enrolCustomer(store: TenantStore, customerId: string): MembershipRow {
  return store.transaction(() => {
    const existing = store.findBy<MembershipRow & Record<string, unknown>>(
      'memberships', 'customer_id = @customerId', { customerId },
    );
    if (existing) return existing as MembershipRow;

    const settings = loadSettings(store);
    const now = nowIso();
    const bonus = Math.max(0, settings.signup_bonus_points);

    const membership = store.insert<MembershipRow & Record<string, unknown>>('memberships', {
      id: newId('mem'),
      customer_id: customerId,
      tier_id: null,
      member_number: newMemberNumber(),
      points_balance: bonus,
      lifetime_points: bonus,
      points_redeemed: 0,
      visits: 0,
      total_spend_cents: 0,
      status: 'active',
      notes: '',
      tags: '[]',
      joined_at: now,
      last_activity_at: now,
      updated_at: now,
    }) as MembershipRow;

    if (bonus > 0) {
      store.insert('transactions', {
        id: newId('txn'),
        membership_id: membership.id,
        type: 'signup_bonus',
        points_delta: bonus,
        balance_after: bonus,
        amount_cents: 0,
        location_id: null,
        staff_user_id: null,
        redemption_id: null,
        source: 'app',
        reference: null,
        note: 'Welcome bonus',
        items: '[]',
        created_at: now,
      });
    }

    const tierId = syncTier(store, membership);
    return { ...membership, tier_id: tierId };
  });
}
