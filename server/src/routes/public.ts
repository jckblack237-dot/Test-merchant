import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { TenantStore } from '../db/tenant';
import { pathParam } from '../middleware/validate';
import { asyncHandler } from '../middleware/errors';
import { notFound } from '../lib/errors';
import { listPublicPlans } from '../services/subscriptions';
import { publicMerchantShape } from './auth';

export const publicRouter = Router();

publicRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/** The SaaS pricing table shown on the marketing site. */
publicRouter.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    res.json({
      plans: listPublicPlans().map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceCents: plan.price_cents,
        currency: plan.currency,
        interval: plan.interval,
        limits: {
          locations: plan.max_locations,
          staff: plan.max_staff,
          members: plan.max_members,
        },
        features: JSON.parse(plan.features) as string[],
      })),
    });
  }),
);

/**
 * Directory of merchants that opted into the customer app.
 * Only public brand information is exposed here — never member counts,
 * revenue, staff or anything else a competitor could mine.
 */
publicRouter.get(
  '/merchants',
  asyncHandler(async (req, res) => {
    const { q, category } = z
      .object({ q: z.string().trim().max(80).optional(), category: z.string().trim().max(40).optional() })
      .parse(req.query);

    const filters: string[] = [`is_listed = 1`, `status = 'active'`];
    const params: Record<string, unknown> = {};
    if (q) {
      filters.push(`(name LIKE @q OR tagline LIKE @q OR description LIKE @q)`);
      params.q = `%${q}%`;
    }
    if (category) {
      filters.push(`category = @category`);
      params.category = category;
    }

    const rows = getDb()
      .prepare(`SELECT * FROM merchants WHERE ${filters.join(' AND ')} ORDER BY name`)
      .all(params) as Record<string, any>[];

    res.json({
      merchants: rows.map((row) => ({
        ...publicMerchantShape(row),
        locationCount: new TenantStore(row.id).count('locations', 'is_active = 1'),
      })),
    });
  }),
);

/** Full storefront for one merchant: locations, menu, rewards and tier ladder. */
publicRouter.get(
  '/merchants/:slug',
  asyncHandler(async (req, res) => {
    const merchant = getDb()
      .prepare(`SELECT * FROM merchants WHERE slug = ? AND is_listed = 1 AND status = 'active'`)
      .get(pathParam(req, 'slug')) as Record<string, any> | undefined;
    if (!merchant) throw notFound('We could not find that rewards programme.');

    const store = new TenantStore(merchant.id);

    res.json({
      merchant: publicMerchantShape(merchant),
      locations: store
        .list('locations', { where: 'is_active = 1', orderBy: 'name' })
        .map(shapeLocation),
      products: store
        .list('products', { where: 'is_active = 1', orderBy: 'sort_order, name' })
        .map(shapeProduct),
      rewards: store
        .list('rewards', { where: 'is_active = 1', orderBy: 'points_cost' })
        .map(shapeReward),
      tiers: store
        .list('tiers', { orderBy: 'min_lifetime_points' })
        .map(shapeTier),
    });
  }),
);

export function shapeLocation(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.name,
    addressLine1: row.address_line1,
    city: row.city,
    region: row.region,
    postcode: row.postcode,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    phone: row.phone,
    openingHours: row.opening_hours,
    imageUrl: row.image_url,
    isActive: Boolean(row.is_active),
  };
}

export function shapeProduct(row: Record<string, any>) {
  return {
    id: row.id,
    locationId: row.location_id,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    pointsOverride: row.points_override,
    isActive: Boolean(row.is_active),
    isFeatured: Boolean(row.is_featured),
    sortOrder: row.sort_order,
  };
}

export function shapeReward(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    pointsCost: row.points_cost,
    imageUrl: row.image_url,
    category: row.category,
    stock: row.stock,
    perMemberLimit: row.per_member_limit,
    isActive: Boolean(row.is_active),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

export function shapeTier(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.name,
    minLifetimePoints: row.min_lifetime_points,
    multiplier: row.multiplier,
    color: row.color,
    perks: JSON.parse(row.perks ?? '[]') as string[],
  };
}
