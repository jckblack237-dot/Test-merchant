import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { TenantStore } from '../db/tenant';
import { asyncHandler } from '../middleware/errors';
import { parseBody, pathParam } from '../middleware/validate';
import { conflict, notFound } from '../lib/errors';
import { customerPrincipal, requireCustomerAuth } from '../middleware/auth';
import { nowIso } from '../lib/time';
import { signQrToken } from '../lib/tokens';
import { emailSchema, nameSchema } from '../lib/validators';
import {
  enrolCustomer, loadTiers, nextTier, redeemReward, tierForPoints, type MembershipRow,
} from '../services/loyalty';
import { publicMerchantShape } from './auth';
import { shapeLocation, shapeProduct, shapeReward, shapeTier } from './public';

export const customerRouter = Router();
customerRouter.use(requireCustomerAuth);

interface MerchantRecord { id: string; status: string; [k: string]: unknown }

/**
 * Resolves a merchant the customer is addressing. The customer's own identity
 * always comes from the token; the merchant id is just which programme they are
 * looking at, and grants no access to that merchant's other members.
 */
function activeMerchant(merchantId: string): MerchantRecord {
  const merchant = getDb()
    .prepare(`SELECT * FROM merchants WHERE id = ? AND status = 'active'`)
    .get(merchantId) as MerchantRecord | undefined;
  if (!merchant) throw notFound('We could not find that rewards programme.');
  return merchant;
}

/** Loads the caller's own membership. Never accepts a membership id from the client. */
function ownMembership(customerId: string, merchantId: string): MembershipRow {
  const row = getDb()
    .prepare(`SELECT * FROM memberships WHERE customer_id = ? AND merchant_id = ?`)
    .get(customerId, merchantId) as MembershipRow | undefined;
  if (!row) throw notFound('You have not joined this rewards programme yet.');
  return row;
}

function shapeMembership(membership: MembershipRow, merchant: Record<string, any>, store: TenantStore) {
  const tiers = loadTiers(store);
  const current = tierForPoints(tiers, membership.lifetime_points);
  const upcoming = nextTier(tiers, membership.lifetime_points);
  return {
    id: membership.id,
    memberNumber: membership.member_number,
    pointsBalance: membership.points_balance,
    lifetimePoints: membership.lifetime_points,
    pointsRedeemed: membership.points_redeemed,
    visits: membership.visits,
    totalSpendCents: membership.total_spend_cents,
    status: membership.status,
    joinedAt: membership.joined_at,
    lastActivityAt: membership.last_activity_at,
    merchant: publicMerchantShape(merchant),
    tier: current ? shapeTier(current as unknown as Record<string, any>) : null,
    nextTier: upcoming
      ? {
          ...shapeTier(upcoming as unknown as Record<string, any>),
          pointsToGo: Math.max(0, upcoming.min_lifetime_points - membership.lifetime_points),
        }
      : null,
  };
}

/** Every programme this customer belongs to, with live balances. */
customerRouter.get(
  '/wallet',
  asyncHandler(async (req, res) => {
    const { customerId } = customerPrincipal(req);
    const rows = getDb()
      .prepare(
        `SELECT m.*, mch.name AS merchant_name
         FROM memberships m
         JOIN merchants mch ON mch.id = m.merchant_id
         WHERE m.customer_id = ? AND mch.status = 'active'
         ORDER BY m.last_activity_at DESC NULLS LAST, m.joined_at DESC`,
      )
      .all(customerId) as (MembershipRow & { merchant_name: string })[];

    const wallet = rows.map((membership) => {
      const merchant = getDb().prepare(`SELECT * FROM merchants WHERE id = ?`).get(membership.merchant_id) as Record<string, any>;
      return shapeMembership(membership, merchant, new TenantStore(membership.merchant_id));
    });

    res.json({
      wallet,
      totals: {
        programmes: wallet.length,
        pointsAcrossProgrammes: wallet.reduce((sum, w) => sum + w.pointsBalance, 0),
      },
    });
  }),
);

/** Join a programme. Idempotent — joining twice returns the existing membership. */
customerRouter.post(
  '/merchants/:merchantId/join',
  asyncHandler(async (req, res) => {
    const { customerId } = customerPrincipal(req);
    const merchant = activeMerchant(pathParam(req, 'merchantId'));
    const store = new TenantStore(merchant.id);
    const membership = enrolCustomer(store, customerId);
    store.writeAudit({
      actorType: 'customer',
      actorId: customerId,
      action: 'membership.joined',
      entityType: 'membership',
      entityId: membership.id,
      ip: req.ip,
    });
    res.status(201).json({ membership: shapeMembership(membership, merchant, store) });
  }),
);

customerRouter.get(
  '/merchants/:merchantId/membership',
  asyncHandler(async (req, res) => {
    const { customerId } = customerPrincipal(req);
    const merchant = activeMerchant(pathParam(req, 'merchantId'));
    const membership = ownMembership(customerId, merchant.id);
    const store = new TenantStore(merchant.id);
    res.json({ membership: shapeMembership(membership, merchant, store) });
  }),
);

/**
 * Short-lived QR payload the customer shows at the counter. Regenerated on each
 * request so a screenshot cannot be reused later by someone else.
 */
customerRouter.get(
  '/merchants/:merchantId/qr',
  asyncHandler(async (req, res) => {
    const { customerId } = customerPrincipal(req);
    const merchant = activeMerchant(pathParam(req, 'merchantId'));
    const membership = ownMembership(customerId, merchant.id);
    const ttlSeconds = 120;
    res.json({
      token: signQrToken(membership.id, ttlSeconds),
      memberNumber: membership.member_number,
      expiresInSeconds: ttlSeconds,
    });
  }),
);

customerRouter.get(
  '/merchants/:merchantId/activity',
  asyncHandler(async (req, res) => {
    const { customerId } = customerPrincipal(req);
    const merchant = activeMerchant(pathParam(req, 'merchantId'));
    const membership = ownMembership(customerId, merchant.id);
    const store = new TenantStore(merchant.id);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);

    const rows = store.list('transactions', {
      where: 'membership_id = @membershipId',
      params: { membershipId: membership.id },
      orderBy: 'created_at DESC',
      limit,
    });

    res.json({
      activity: rows.map((row: Record<string, any>) => ({
        id: row.id,
        type: row.type,
        pointsDelta: row.points_delta,
        balanceAfter: row.balance_after,
        amountCents: row.amount_cents,
        note: row.note,
        items: JSON.parse(row.items ?? '[]'),
        createdAt: row.created_at,
      })),
    });
  }),
);

customerRouter.get(
  '/merchants/:merchantId/catalog',
  asyncHandler(async (req, res) => {
    const merchant = activeMerchant(pathParam(req, 'merchantId'));
    const store = new TenantStore(merchant.id);
    res.json({
      merchant: publicMerchantShape(merchant),
      locations: store.list('locations', { where: 'is_active = 1', orderBy: 'name' }).map(shapeLocation),
      products: store.list('products', { where: 'is_active = 1', orderBy: 'sort_order, name' }).map(shapeProduct),
      rewards: store.list('rewards', { where: 'is_active = 1', orderBy: 'points_cost' }).map(shapeReward),
      tiers: store.list('tiers', { orderBy: 'min_lifetime_points' }).map(shapeTier),
    });
  }),
);

const redeemSchema = z.object({
  rewardId: z.string().min(3),
  locationId: z.string().min(3).optional(),
});

customerRouter.post(
  '/merchants/:merchantId/redeem',
  asyncHandler(async (req, res) => {
    const { customerId } = customerPrincipal(req);
    const merchant = activeMerchant(pathParam(req, 'merchantId'));
    const membership = ownMembership(customerId, merchant.id);
    const input = parseBody(redeemSchema, req);
    const store = new TenantStore(merchant.id);

    const result = redeemReward(store, {
      membershipId: membership.id,
      rewardId: input.rewardId,
      locationId: input.locationId ?? null,
    });

    store.writeAudit({
      actorType: 'customer',
      actorId: customerId,
      action: 'reward.redeemed',
      entityType: 'redemption',
      entityId: String(result.redemption.id),
      ip: req.ip,
      meta: { rewardId: input.rewardId, pointsSpent: result.redemption.points_spent },
    });

    res.status(201).json({
      redemption: shapeRedemption(result.redemption, store),
      membership: shapeMembership(result.membership, merchant, store),
    });
  }),
);

/** Redemption codes the customer still needs to collect, across all programmes. */
customerRouter.get(
  '/redemptions',
  asyncHandler(async (req, res) => {
    const { customerId } = customerPrincipal(req);
    const rows = getDb()
      .prepare(
        `SELECT r.*, w.name AS reward_name, w.description AS reward_description,
                mch.name AS merchant_name, mch.brand_color AS merchant_color, mch.id AS merchant_id
         FROM redemptions r
         JOIN memberships m ON m.id = r.membership_id
         JOIN rewards w ON w.id = r.reward_id
         JOIN merchants mch ON mch.id = r.merchant_id
         WHERE m.customer_id = ?
         ORDER BY r.created_at DESC
         LIMIT 100`,
      )
      .all(customerId) as Record<string, any>[];

    res.json({
      redemptions: rows.map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        pointsSpent: row.points_spent,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        fulfilledAt: row.fulfilled_at,
        reward: { id: row.reward_id, name: row.reward_name, description: row.reward_description },
        merchant: { id: row.merchant_id, name: row.merchant_name, brandColor: row.merchant_color },
      })),
    });
  }),
);

const profileSchema = z.object({
  name: nameSchema.optional(),
  email: emailSchema.optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  marketingOptIn: z.boolean().optional(),
});

customerRouter.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const { customerId } = customerPrincipal(req);
    const input = parseBody(profileSchema, req);
    const db = getDb();

    if (input.email) {
      const taken = db.prepare(`SELECT id FROM customers WHERE email = ? AND id != ?`).get(input.email, customerId);
      if (taken) throw conflict('That email address is already in use.');
    }

    const updates: Record<string, unknown> = { updated_at: nowIso() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.email !== undefined) updates.email = input.email;
    if (input.phone !== undefined) updates.phone = input.phone;
    if (input.marketingOptIn !== undefined) updates.marketing_opt_in = input.marketingOptIn ? 1 : 0;

    const assignments = Object.keys(updates).map((key) => `${key} = @${key}`).join(', ');
    db.prepare(`UPDATE customers SET ${assignments} WHERE id = @id`).run({ ...updates, id: customerId });

    res.json({
      customer: db
        .prepare(`SELECT id, name, email, phone, avatar_url, marketing_opt_in FROM customers WHERE id = ?`)
        .get(customerId),
    });
  }),
);

export function shapeRedemption(row: Record<string, any>, store: TenantStore) {
  const reward = store.find<{ name: string; description: string }>('rewards', row.reward_id);
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    pointsSpent: row.points_spent,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    fulfilledAt: row.fulfilled_at,
    reward: reward ? { id: row.reward_id, name: reward.name, description: reward.description } : null,
  };
}
