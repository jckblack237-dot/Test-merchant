import { Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { asyncHandler } from '../../middleware/errors';
import { merchantPrincipal, requireRole, requireStaffSession, store } from '../../middleware/auth';
import { parseBody, pathParam } from '../../middleware/validate';
import { requireActiveSubscription } from '../../middleware/subscription';
import { assertCapacity, getMerchant, getPlan } from '../../services/subscriptions';
import { conflict } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso } from '../../lib/time';
import { hexColorSchema, optionalUrlSchema } from '../../lib/validators';
import type { TenantTable } from '../../db/tenant';
import { shapeLocation, shapeProduct, shapeReward, shapeTier } from '../public';

export const catalogRouter = Router();

/**
 * Locations, products, rewards, tiers and campaigns are all "merchant owns a
 * list of things" resources with the same shape, so they share one CRUD factory.
 * Every operation runs through req.store, which pins the merchant id — a
 * request for another tenant's product id simply 404s.
 */
function crud(options: {
  table: TenantTable;
  label: string;
  orderBy: string;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  idPrefix: Parameters<typeof newId>[0];
  toRow: (input: Record<string, any>) => Record<string, unknown>;
  shape: (row: Record<string, any>) => unknown;
  /** Optional plan-limit resource this table counts against. */
  capacity?: 'locations';
  /** Runs before delete; throw to block. */
  beforeDelete?: (store: ReturnType<typeof storeOf>, id: string) => void;
  writeRole?: 'owner' | 'manager' | 'staff';
}) {
  const router = Router({ mergeParams: true });
  const writeRole = options.writeRole ?? 'manager';

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const s = store(req);
      res.json({ items: s.list(options.table, { orderBy: options.orderBy }).map(options.shape) });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const s = store(req);
      res.json({ item: options.shape(s.findOrFail(options.table, pathParam(req, 'id'), options.label)) });
    }),
  );

  router.post(
    '/',
    requireStaffSession,
    requireRole(writeRole),
    requireActiveSubscription,
    asyncHandler(async (req, res) => {
      const s = store(req);
      const principal = merchantPrincipal(req);
      const input = parseBody(options.createSchema, req);
      if (options.capacity) {
        const merchant = getMerchant(s.merchantId);
        assertCapacity(s, options.capacity, getPlan(merchant.plan_code));
      }
      const now = nowIso();
      const row = s.insert(options.table, {
        id: newId(options.idPrefix),
        ...options.toRow(input),
        created_at: now,
        updated_at: now,
      });
      s.writeAudit({
        actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
        action: `${options.table}.created`, entityType: options.table, entityId: String(row.id), ip: req.ip,
      });
      res.status(201).json({ item: options.shape(row) });
    }),
  );

  router.patch(
    '/:id',
    requireStaffSession,
    requireRole(writeRole),
    requireActiveSubscription,
    asyncHandler(async (req, res) => {
      const s = store(req);
      const principal = merchantPrincipal(req);
      const input = parseBody(options.updateSchema, req);
      const row = s.update(
        options.table,
        pathParam(req, 'id'),
        { ...options.toRow(input), updated_at: nowIso() },
        options.label,
      );
      s.writeAudit({
        actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
        action: `${options.table}.updated`, entityType: options.table, entityId: String(row.id), ip: req.ip,
      });
      res.json({ item: options.shape(row) });
    }),
  );

  router.delete(
    '/:id',
    requireStaffSession,
    requireRole(writeRole),
    asyncHandler(async (req, res) => {
      const s = store(req);
      const principal = merchantPrincipal(req);
      s.findOrFail(options.table, pathParam(req, 'id'), options.label);
      options.beforeDelete?.(s, pathParam(req, 'id'));
      s.delete(options.table, pathParam(req, 'id'), options.label);
      s.writeAudit({
        actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
        action: `${options.table}.deleted`, entityType: options.table, entityId: pathParam(req, 'id'), ip: req.ip,
      });
      res.status(204).end();
    }),
  );

  return router;
}

function storeOf(req: Parameters<typeof store>[0]) {
  return store(req);
}

/** Strips undefined so a PATCH only writes the fields the client actually sent. */
function defined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

// --- Locations --------------------------------------------------------------

const locationFields = {
  name: z.string().trim().min(1).max(120),
  addressLine1: z.string().trim().max(200).default(''),
  city: z.string().trim().max(80).default(''),
  region: z.string().trim().max(80).default(''),
  postcode: z.string().trim().max(20).default(''),
  country: z.string().trim().max(60).default(''),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  openingHours: z.string().trim().max(300).default(''),
  imageUrl: optionalUrlSchema,
  isActive: z.boolean().default(true),
};

const locationToRow = (input: Record<string, any>) =>
  defined({
    name: input.name,
    address_line1: input.addressLine1,
    city: input.city,
    region: input.region,
    postcode: input.postcode,
    country: input.country,
    lat: input.lat,
    lng: input.lng,
    phone: input.phone,
    opening_hours: input.openingHours,
    image_url: input.imageUrl,
    is_active: input.isActive === undefined ? undefined : input.isActive ? 1 : 0,
  });

catalogRouter.use(
  '/locations',
  crud({
    table: 'locations',
    label: 'Location',
    orderBy: 'name',
    idPrefix: 'loc',
    capacity: 'locations',
    createSchema: z.object(locationFields),
    updateSchema: z.object(locationFields).partial(),
    toRow: locationToRow,
    shape: shapeLocation,
  }),
);

// --- Products ---------------------------------------------------------------

const productFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  category: z.string().trim().max(60).default('General'),
  priceCents: z.number().int().min(0).max(10_000_000).default(0),
  imageUrl: optionalUrlSchema,
  locationId: z.string().min(3).nullable().optional(),
  pointsOverride: z.number().int().min(0).max(100_000).nullable().optional(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(0),
};

const productToRow = (input: Record<string, any>) =>
  defined({
    name: input.name,
    description: input.description,
    category: input.category,
    price_cents: input.priceCents,
    image_url: input.imageUrl,
    location_id: input.locationId,
    points_override: input.pointsOverride,
    is_active: input.isActive === undefined ? undefined : input.isActive ? 1 : 0,
    is_featured: input.isFeatured === undefined ? undefined : input.isFeatured ? 1 : 0,
    sort_order: input.sortOrder,
  });

catalogRouter.use(
  '/products',
  crud({
    table: 'products',
    label: 'Product',
    orderBy: 'sort_order, name',
    idPrefix: 'prd',
    createSchema: z.object(productFields),
    updateSchema: z.object(productFields).partial(),
    toRow: productToRow,
    shape: shapeProduct,
  }),
);

// --- Rewards ----------------------------------------------------------------

const rewardFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  pointsCost: z.number().int().min(1).max(1_000_000),
  category: z.string().trim().max(60).default('Drinks'),
  imageUrl: optionalUrlSchema,
  stock: z.number().int().min(-1).max(1_000_000).default(-1),
  perMemberLimit: z.number().int().min(-1).max(1000).default(-1),
  isActive: z.boolean().default(true),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
};

const rewardToRow = (input: Record<string, any>) =>
  defined({
    name: input.name,
    description: input.description,
    points_cost: input.pointsCost,
    category: input.category,
    image_url: input.imageUrl,
    stock: input.stock,
    per_member_limit: input.perMemberLimit,
    is_active: input.isActive === undefined ? undefined : input.isActive ? 1 : 0,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    sort_order: input.sortOrder,
  });

catalogRouter.use(
  '/rewards',
  crud({
    table: 'rewards',
    label: 'Reward',
    orderBy: 'points_cost',
    idPrefix: 'rwd',
    createSchema: z.object(rewardFields),
    updateSchema: z.object(rewardFields).partial(),
    toRow: rewardToRow,
    shape: shapeReward,
    // Redemptions reference rewards, so removing one would orphan a customer's
    // history. Deactivate instead of deleting once it has been redeemed.
    beforeDelete: (s, id) => {
      const used = s.count('redemptions', 'reward_id = @rewardId', { rewardId: id });
      if (used > 0) {
        throw conflict(
          'This reward has been redeemed before, so it cannot be deleted. Switch it off instead to hide it.',
        );
      }
    },
  }),
);

// --- Tiers ------------------------------------------------------------------

const tierFields = {
  name: z.string().trim().min(1).max(60),
  minLifetimePoints: z.number().int().min(0).max(10_000_000),
  multiplier: z.number().min(0.1).max(20),
  color: hexColorSchema.default('#94A3B8'),
  perks: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  sortOrder: z.number().int().min(0).max(999).default(0),
};

const tierToRow = (input: Record<string, any>) =>
  defined({
    name: input.name,
    min_lifetime_points: input.minLifetimePoints,
    multiplier: input.multiplier,
    color: input.color,
    perks: input.perks === undefined ? undefined : JSON.stringify(input.perks),
    sort_order: input.sortOrder,
  });

catalogRouter.use(
  '/tiers',
  crud({
    table: 'tiers',
    label: 'Tier',
    orderBy: 'min_lifetime_points',
    idPrefix: 'tie',
    writeRole: 'owner',
    createSchema: z.object(tierFields),
    updateSchema: z.object(tierFields).partial(),
    toRow: tierToRow,
    shape: shapeTier,
  }),
);

// --- Campaigns --------------------------------------------------------------

const campaignFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  type: z.enum(['multiplier', 'bonus']).default('multiplier'),
  multiplier: z.number().min(1).max(10).default(1),
  bonusPoints: z.number().int().min(0).max(100_000).default(0),
  minSpendCents: z.number().int().min(0).max(10_000_000).default(0),
  locationId: z.string().min(3).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
};

const campaignToRow = (input: Record<string, any>) =>
  defined({
    name: input.name,
    description: input.description,
    type: input.type,
    multiplier: input.multiplier,
    bonus_points: input.bonusPoints,
    min_spend_cents: input.minSpendCents,
    location_id: input.locationId,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    is_active: input.isActive === undefined ? undefined : input.isActive ? 1 : 0,
  });

const shapeCampaign = (row: Record<string, any>) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  type: row.type,
  multiplier: row.multiplier,
  bonusPoints: row.bonus_points,
  minSpendCents: row.min_spend_cents,
  locationId: row.location_id,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  isActive: Boolean(row.is_active),
});

catalogRouter.use(
  '/campaigns',
  crud({
    table: 'campaigns',
    label: 'Campaign',
    orderBy: 'created_at DESC',
    idPrefix: 'cmp',
    createSchema: z.object(campaignFields),
    updateSchema: z.object(campaignFields).partial(),
    toRow: campaignToRow,
    shape: shapeCampaign,
  }),
);
