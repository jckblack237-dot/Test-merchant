import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors';
import { merchantPrincipal, requireRole, requireStaffSession, store } from '../../middleware/auth';
import { parseBody } from '../../middleware/validate';
import { getDb } from '../../db';
import { conflict } from '../../lib/errors';
import { nowIso } from '../../lib/time';
import { hexColorSchema, nameSchema, optionalUrlSchema, slugSchema } from '../../lib/validators';
import {
  cancelSubscription, changePlan, getMerchant, listPublicPlans, subscriptionState, usageFor,
} from '../../services/subscriptions';
import { publicMerchantShape } from '../auth';

export const accountRouter = Router();

/** Brand and loyalty-programme settings. */
accountRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const merchant = getMerchant(s.merchantId);
    res.json({
      merchant: {
        ...publicMerchantShape(merchant),
        timezone: merchant.timezone,
        redeemNeedsStaff: Boolean(merchant.redeem_needs_staff),
      },
      subscription: subscriptionState(merchant),
      usage: usageFor(s),
    });
  }),
);

const settingsSchema = z.object({
  name: nameSchema.optional(),
  slug: slugSchema.optional(),
  tagline: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(40).optional(),
  logoUrl: optionalUrlSchema,
  coverUrl: optionalUrlSchema,
  brandColor: hexColorSchema.optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  timezone: z.string().trim().max(60).optional(),
  pointsPerCurrency: z.number().min(0).max(1000).optional(),
  signupBonusPoints: z.number().int().min(0).max(100_000).optional(),
  pointsExpiryDays: z.number().int().min(0).max(3650).nullable().optional(),
  redeemNeedsStaff: z.boolean().optional(),
  isListed: z.boolean().optional(),
});

accountRouter.patch(
  '/settings',
  requireStaffSession,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const input = parseBody(settingsSchema, req);
    const db = getDb();

    if (input.slug) {
      const taken = db.prepare(`SELECT 1 FROM merchants WHERE slug = ? AND id != ?`).get(input.slug, s.merchantId);
      if (taken) throw conflict('That web address is already taken.');
    }

    const mapping: Record<string, unknown> = {
      name: input.name,
      slug: input.slug,
      tagline: input.tagline,
      description: input.description,
      category: input.category,
      logo_url: input.logoUrl,
      cover_url: input.coverUrl,
      brand_color: input.brandColor,
      currency: input.currency,
      country: input.country,
      timezone: input.timezone,
      points_per_currency: input.pointsPerCurrency,
      signup_bonus_points: input.signupBonusPoints,
      points_expiry_days: input.pointsExpiryDays,
      redeem_needs_staff: input.redeemNeedsStaff === undefined ? undefined : input.redeemNeedsStaff ? 1 : 0,
      is_listed: input.isListed === undefined ? undefined : input.isListed ? 1 : 0,
    };
    const updates = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== undefined));
    updates.updated_at = nowIso();

    const assignments = Object.keys(updates).map((key) => `${key} = @${key}`).join(', ');
    db.prepare(`UPDATE merchants SET ${assignments} WHERE id = @id`).run({ ...updates, id: s.merchantId });

    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'settings.updated', entityType: 'merchant', entityId: s.merchantId, ip: req.ip,
      meta: { fields: Object.keys(input) },
    });

    const merchant = getMerchant(s.merchantId);
    res.json({
      merchant: { ...publicMerchantShape(merchant), timezone: merchant.timezone, redeemNeedsStaff: Boolean(merchant.redeem_needs_staff) },
    });
  }),
);

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

accountRouter.get(
  '/billing',
  requireStaffSession,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const merchant = getMerchant(s.merchantId);
    const state = subscriptionState(merchant);
    res.json({
      subscription: {
        planCode: state.plan.code,
        planName: state.plan.name,
        priceCents: state.plan.price_cents,
        currency: state.plan.currency,
        interval: state.plan.interval,
        status: state.status,
        writable: state.writable,
        trialDaysLeft: state.trialDaysLeft,
        renewsAt: state.renewsAt,
        reason: state.reason ?? null,
        limits: {
          locations: state.plan.max_locations,
          staff: state.plan.max_staff,
          members: state.plan.max_members,
        },
      },
      usage: usageFor(s),
      availablePlans: listPublicPlans().map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceCents: plan.price_cents,
        currency: plan.currency,
        interval: plan.interval,
        limits: { locations: plan.max_locations, staff: plan.max_staff, members: plan.max_members },
        features: JSON.parse(plan.features) as string[],
      })),
    });
  }),
);

/**
 * Switches plan.
 *
 * This is where a payment provider (Stripe et al.) would be called; the record
 * of what the merchant is entitled to lives here either way, so the paywall
 * keeps working whatever processor is wired in later.
 */
accountRouter.post(
  '/billing/plan',
  requireStaffSession,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const { planCode } = parseBody(z.object({ planCode: z.enum(['starter', 'growth', 'scale']) }), req);
    const merchant = changePlan(s.merchantId, planCode);
    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'billing.plan_changed', entityType: 'merchant', entityId: s.merchantId, ip: req.ip,
      meta: { planCode },
    });
    res.json({ subscription: subscriptionState(merchant) });
  }),
);

accountRouter.post(
  '/billing/cancel',
  requireStaffSession,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const merchant = cancelSubscription(s.merchantId);
    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'billing.cancelled', entityType: 'merchant', entityId: s.merchantId, ip: req.ip,
    });
    res.json({ subscription: subscriptionState(merchant) });
  }),
);

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Each merchant's own audit trail. Scoped like everything else, so one tenant
 * can review its staff's activity without ever seeing another tenant's.
 */
accountRouter.get(
  '/audit',
  requireStaffSession,
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const { limit, offset, action } = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(100),
        offset: z.coerce.number().int().min(0).default(0),
        action: z.string().trim().max(60).optional(),
      })
      .parse(req.query);

    const entries = s.list('audit_logs', {
      ...(action ? { where: 'action = @action', params: { action } } : {}),
      orderBy: 'created_at DESC',
      limit,
      offset,
    });

    res.json({
      entries: entries.map((row: Record<string, any>) => ({
        id: row.id,
        actorType: row.actor_type,
        actorId: row.actor_id,
        actorLabel: row.actor_label,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        ip: row.ip,
        meta: JSON.parse(row.meta ?? '{}'),
        createdAt: row.created_at,
      })),
      total: action ? s.count('audit_logs', 'action = @action', { action }) : s.count('audit_logs'),
    });
  }),
);
