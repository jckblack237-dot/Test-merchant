import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors';
import { merchantPrincipal, requireRole, requireStaffSession, store } from '../../middleware/auth';
import { parseBody, pathParam } from '../../middleware/validate';
import { requireActiveSubscription } from '../../middleware/subscription';
import { badRequest, notFound } from '../../lib/errors';
import { verifyQrToken } from '../../lib/tokens';
import {
  adjustPoints, awardPoints, calculatePoints, cancelRedemption, fulfilRedemption,
  loadTiers, tierForPoints,
} from '../../services/loyalty';
import { getMerchant } from '../../services/subscriptions';
import { shapeLedgerRow, shapeMemberRow } from './members';
import { shapeTier } from '../public';

export const pointsRouter = Router();

const lookupSchema = z.object({
  /** Exactly one of these identifies the member standing at the counter. */
  qrToken: z.string().min(10).optional(),
  memberNumber: z.string().trim().min(3).max(20).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
}).refine(
  (value) => Boolean(value.qrToken || value.memberNumber || value.email),
  { message: 'Scan a QR code or enter a member number or email.' },
);

/**
 * Counter lookup: turn a scanned QR, a member number or an email into a member.
 *
 * A QR token is signed with the merchant id it was minted for, so scanning a
 * customer's code for Merchant B on Merchant A's till resolves to nothing.
 */
pointsRouter.post(
  '/lookup',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const input = parseBody(lookupSchema, req);

    // A scanned code resolves to a membership id, which is then looked up
    // through the tenant-scoped store: a code from another shop's programme
    // finds nothing here, so it reads as "no member" rather than leaking that
    // the customer is a member somewhere else.
    const membershipId = input.qrToken ? verifyQrToken(input.qrToken).membershipId : null;

    const row = membershipId
      ? s.queryOne<Record<string, any>>(
          `SELECT m.*, c.name, c.email, c.phone, t.name AS tier_name, t.color AS tier_color
           FROM memberships m
           JOIN customers c ON c.id = m.customer_id
           LEFT JOIN tiers t ON t.id = m.tier_id
           WHERE m.merchant_id = @merchantId AND m.id = @id`,
          { id: membershipId },
        )
      : s.queryOne<Record<string, any>>(
          `SELECT m.*, c.name, c.email, c.phone, t.name AS tier_name, t.color AS tier_color
           FROM memberships m
           JOIN customers c ON c.id = m.customer_id
           LEFT JOIN tiers t ON t.id = m.tier_id
           WHERE m.merchant_id = @merchantId
             AND (m.member_number = @memberNumber OR c.email = @email)`,
          { memberNumber: input.memberNumber ?? null, email: input.email ?? null },
        );

    if (!row) throw notFound('No member found. Ask them to join your programme first.');

    const tiers = loadTiers(s);
    const tier = tierForPoints(tiers, row.lifetime_points);

    const pending = s.query<Record<string, any>>(
      `SELECT r.id, r.code, r.points_spent, r.created_at, w.name AS reward_name
       FROM redemptions r
       JOIN rewards w ON w.id = r.reward_id
       WHERE r.merchant_id = @merchantId AND r.membership_id = @membershipId AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
      { membershipId: row.id },
    );

    res.json({
      member: {
        ...shapeMemberRow(row),
        tier: tier ? shapeTier(tier as unknown as Record<string, any>) : null,
      },
      pendingRedemptions: pending.map((r) => ({
        id: r.id, code: r.code, pointsSpent: r.points_spent, rewardName: r.reward_name, createdAt: r.created_at,
      })),
      recentActivity: s
        .list('transactions', {
          where: 'membership_id = @membershipId',
          params: { membershipId: row.id },
          orderBy: 'created_at DESC',
          limit: 5,
        })
        .map(shapeLedgerRow),
    });
  }),
);

const awardSchema = z.object({
  membershipId: z.string().min(3),
  amountCents: z.number().int().min(0).max(100_000_000),
  locationId: z.string().min(3).optional(),
  productIds: z.array(z.string().min(3)).max(50).optional(),
  reference: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Award points for a purchase. This is the till's main endpoint. */
pointsRouter.post(
  '/award',
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const input = parseBody(awardSchema, req);

    const result = awardPoints(s, {
      membershipId: input.membershipId,
      amountCents: input.amountCents,
      locationId: input.locationId ?? null,
      productIds: input.productIds,
      staffUserId: principal.userId,
      source: principal.kind === 'api_key' ? 'pos' : 'crm',
      reference: input.reference ?? null,
      note: input.note ?? '',
    });

    s.writeAudit({
      actorType: principal.kind, actorId: principal.userId, actorLabel: principal.name,
      action: 'points.awarded', entityType: 'membership', entityId: input.membershipId, ip: req.ip,
      meta: { points: result.breakdown.total, amountCents: input.amountCents, reference: input.reference ?? null },
    });

    res.status(201).json({
      transaction: shapeLedgerRow(result.transaction as Record<string, any>),
      breakdown: result.breakdown,
      member: shapeMemberRow(result.membership as unknown as Record<string, any>),
      tierUpgradedTo: result.tierChangedTo ? shapeTier(result.tierChangedTo as unknown as Record<string, any>) : null,
    });
  }),
);

/** Dry run of the earn rules, so staff can see the points before confirming. */
pointsRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const input = parseBody(
      z.object({
        membershipId: z.string().min(3).optional(),
        amountCents: z.number().int().min(0).max(100_000_000),
        locationId: z.string().min(3).optional(),
      }),
      req,
    );

    const merchant = getMerchant(s.merchantId);
    const tiers = loadTiers(s);
    let tier = null;
    if (input.membershipId) {
      const membership = s.findOrFail<{ lifetime_points: number }>('memberships', input.membershipId, 'Member');
      tier = tierForPoints(tiers, membership.lifetime_points);
    }

    const now = new Date().toISOString();
    const campaigns = s.list<any>('campaigns', {
      where: `is_active = 1
              AND (starts_at IS NULL OR starts_at <= @now)
              AND (ends_at IS NULL OR ends_at >= @now)
              AND (location_id IS NULL OR location_id = @locationId)`,
      params: { now, locationId: input.locationId ?? null },
    });

    res.json({
      breakdown: calculatePoints({
        amountCents: input.amountCents,
        settings: {
          points_per_currency: merchant.points_per_currency as number,
          signup_bonus_points: merchant.signup_bonus_points as number,
          points_expiry_days: merchant.points_expiry_days as number | null,
          redeem_needs_staff: merchant.redeem_needs_staff as number,
        },
        tier,
        campaigns,
      }),
    });
  }),
);

const adjustSchema = z.object({
  membershipId: z.string().min(3),
  points: z.number().int().refine((v) => v !== 0, 'Enter a non-zero adjustment.'),
  note: z.string().trim().min(3, 'Say why you are adjusting these points.').max(500),
});

/** Manual correction. Manager+ only, and always leaves an audit trail. */
pointsRouter.post(
  '/adjust',
  requireStaffSession,
  requireRole('manager'),
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const input = parseBody(adjustSchema, req);

    const result = adjustPoints(s, {
      membershipId: input.membershipId,
      points: input.points,
      note: input.note,
      staffUserId: principal.userId,
    });

    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'points.adjusted', entityType: 'membership', entityId: input.membershipId, ip: req.ip,
      meta: { points: input.points, note: input.note },
    });

    res.status(201).json({
      transaction: shapeLedgerRow(result.transaction as Record<string, any>),
      member: shapeMemberRow(result.membership as unknown as Record<string, any>),
    });
  }),
);

// ---------------------------------------------------------------------------
// Redemption queue
// ---------------------------------------------------------------------------

pointsRouter.get(
  '/redemptions',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const { status, limit } = z
      .object({
        status: z.enum(['pending', 'fulfilled', 'cancelled', 'expired', 'all']).default('pending'),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);

    const statusFilter = status === 'all' ? '' : ' AND r.status = @status';
    const rows = s.query<Record<string, any>>(
      `SELECT r.*, w.name AS reward_name, c.name AS customer_name, m.member_number
       FROM redemptions r
       JOIN rewards w ON w.id = r.reward_id
       JOIN memberships m ON m.id = r.membership_id
       JOIN customers c ON c.id = m.customer_id
       WHERE r.merchant_id = @merchantId${statusFilter}
       ORDER BY r.created_at DESC
       LIMIT @limit`,
      { status, limit },
    );

    res.json({
      redemptions: rows.map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        pointsSpent: row.points_spent,
        rewardName: row.reward_name,
        customerName: row.customer_name,
        memberNumber: row.member_number,
        membershipId: row.membership_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        fulfilledAt: row.fulfilled_at,
      })),
    });
  }),
);

/** Look a redemption code up at the counter before handing the reward over. */
pointsRouter.get(
  '/redemptions/code/:code',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const row = s.queryOne<Record<string, any>>(
      `SELECT r.*, w.name AS reward_name, c.name AS customer_name, m.member_number
       FROM redemptions r
       JOIN rewards w ON w.id = r.reward_id
       JOIN memberships m ON m.id = r.membership_id
       JOIN customers c ON c.id = m.customer_id
       WHERE r.merchant_id = @merchantId AND r.code = @code`,
      { code: pathParam(req, 'code').toUpperCase() },
    );
    if (!row) throw notFound('No redemption found for that code.');
    res.json({
      redemption: {
        id: row.id, code: row.code, status: row.status, pointsSpent: row.points_spent,
        rewardName: row.reward_name, customerName: row.customer_name, memberNumber: row.member_number,
        createdAt: row.created_at, expiresAt: row.expires_at, fulfilledAt: row.fulfilled_at,
      },
    });
  }),
);

pointsRouter.post(
  '/redemptions/:id/fulfil',
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const { locationId } = z.object({ locationId: z.string().min(3).optional() }).parse(req.body ?? {});
    const redemption = fulfilRedemption(s, pathParam(req, 'id'), principal.userId, locationId ?? null);
    s.writeAudit({
      actorType: principal.kind, actorId: principal.userId, actorLabel: principal.name,
      action: 'redemption.fulfilled', entityType: 'redemption', entityId: String(redemption.id), ip: req.ip,
    });
    res.json({ redemption });
  }),
);

pointsRouter.post(
  '/redemptions/:id/cancel',
  requireStaffSession,
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const { reason } = z.object({ reason: z.string().trim().max(300).default('') }).parse(req.body ?? {});
    cancelRedemption(s, pathParam(req, 'id'), reason);
    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'redemption.cancelled', entityType: 'redemption', entityId: pathParam(req, 'id'), ip: req.ip,
      meta: { reason },
    });
    res.status(204).end();
  }),
);

/** Recent ledger activity across the whole programme. */
pointsRouter.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const { limit, offset, type } = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        type: z.enum(['earn', 'redeem', 'adjust', 'signup_bonus', 'refund', 'expire']).optional(),
      })
      .parse(req.query);

    const typeFilter = type ? ' AND t.type = @type' : '';
    const rows = s.query<Record<string, any>>(
      `SELECT t.*, c.name AS customer_name, m.member_number, l.name AS location_name, u.name AS staff_name
       FROM transactions t
       JOIN memberships m ON m.id = t.membership_id
       JOIN customers c ON c.id = m.customer_id
       LEFT JOIN locations l ON l.id = t.location_id
       LEFT JOIN merchant_users u ON u.id = t.staff_user_id
       WHERE t.merchant_id = @merchantId${typeFilter}
       ORDER BY t.created_at DESC
       LIMIT @limit OFFSET @offset`,
      { limit, offset, type },
    );

    res.json({
      transactions: rows.map((row) => ({
        ...shapeLedgerRow(row),
        membershipId: row.membership_id,
        customerName: row.customer_name,
        memberNumber: row.member_number,
        locationName: row.location_name,
        staffName: row.staff_name,
      })),
    });
  }),
);
