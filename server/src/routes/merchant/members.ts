import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors';
import { merchantPrincipal, requireRole, requireStaffSession, store } from '../../middleware/auth';
import { parseBody, pathParam } from '../../middleware/validate';
import { requireActiveSubscription } from '../../middleware/subscription';
import { assertCapacity, getMerchant, getPlan } from '../../services/subscriptions';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { paginationSchema } from '../../lib/validators';
import { enrolCustomer, loadTiers, nextTier, tierForPoints, type MembershipRow } from '../../services/loyalty';
import { shapeTier } from '../public';
import { getDb } from '../../db';
import { nowIso } from '../../lib/time';
import { newId } from '../../lib/ids';
import { hashPassword } from '../../lib/passwords';
import { randomToken } from '../../lib/ids';

export const membersRouter = Router();

const listSchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  tierId: z.string().trim().max(64).optional(),
  status: z.enum(['active', 'blocked']).optional(),
  sort: z.enum(['recent', 'points', 'lifetime', 'spend', 'name', 'joined']).default('recent'),
});

const SORTS: Record<string, string> = {
  recent: 'm.last_activity_at DESC NULLS LAST',
  points: 'm.points_balance DESC',
  lifetime: 'm.lifetime_points DESC',
  spend: 'm.total_spend_cents DESC',
  name: 'c.name COLLATE NOCASE ASC',
  joined: 'm.joined_at DESC',
};

/**
 * The merchant's customer database.
 *
 * The join to `customers` is safe because the driving table `memberships` is
 * filtered by merchant_id: a person only appears here if they joined THIS
 * programme. Their memberships elsewhere are never reachable from this query.
 */
membersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const params = listSchema.parse(req.query);

    const filters: string[] = [];
    const bind: Record<string, unknown> = { limit: params.limit, offset: params.offset };
    if (params.q) {
      filters.push(`(c.name LIKE @q OR c.email LIKE @q OR m.member_number LIKE @q OR c.phone LIKE @q)`);
      bind.q = `%${params.q}%`;
    }
    if (params.tierId) {
      filters.push(`m.tier_id = @tierId`);
      bind.tierId = params.tierId;
    }
    if (params.status) {
      filters.push(`m.status = @status`);
      bind.status = params.status;
    }
    const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';

    const rows = s.query<Record<string, any>>(
      `SELECT m.*, c.name, c.email, c.phone, t.name AS tier_name, t.color AS tier_color
       FROM memberships m
       JOIN customers c ON c.id = m.customer_id
       LEFT JOIN tiers t ON t.id = m.tier_id
       WHERE m.merchant_id = @merchantId${where}
       ORDER BY ${SORTS[params.sort]}
       LIMIT @limit OFFSET @offset`,
      bind,
    );

    const total = s.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM memberships m
       JOIN customers c ON c.id = m.customer_id
       WHERE m.merchant_id = @merchantId${where}`,
      bind,
    )!.n;

    res.json({
      members: rows.map(shapeMemberRow),
      pagination: { total, limit: params.limit, offset: params.offset },
    });
  }),
);

/** Full CRM profile for one member, including their complete points ledger. */
membersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const row = s.queryOne<Record<string, any>>(
      `SELECT m.*, c.name, c.email, c.phone, c.marketing_opt_in, c.created_at AS customer_since
       FROM memberships m
       JOIN customers c ON c.id = m.customer_id
       WHERE m.merchant_id = @merchantId AND m.id = @id`,
      { id: pathParam(req, 'id') },
    );
    if (!row) throw notFound('Member not found.');

    const ledger = s.list('transactions', {
      where: 'membership_id = @membershipId',
      params: { membershipId: row.id },
      orderBy: 'created_at DESC',
      limit: 200,
    });

    const redemptions = s.query<Record<string, any>>(
      `SELECT r.*, w.name AS reward_name
       FROM redemptions r
       JOIN rewards w ON w.id = r.reward_id
       WHERE r.merchant_id = @merchantId AND r.membership_id = @membershipId
       ORDER BY r.created_at DESC LIMIT 50`,
      { membershipId: row.id },
    );

    const tiers = loadTiers(s);
    const current = tierForPoints(tiers, row.lifetime_points);
    const upcoming = nextTier(tiers, row.lifetime_points);

    res.json({
      member: {
        ...shapeMemberRow(row),
        notes: row.notes,
        tags: JSON.parse(row.tags ?? '[]'),
        marketingOptIn: Boolean(row.marketing_opt_in),
        customerSince: row.customer_since,
        tier: current ? shapeTier(current as unknown as Record<string, any>) : null,
        nextTier: upcoming
          ? {
              ...shapeTier(upcoming as unknown as Record<string, any>),
              pointsToGo: Math.max(0, upcoming.min_lifetime_points - row.lifetime_points),
            }
          : null,
      },
      ledger: ledger.map(shapeLedgerRow),
      redemptions: redemptions.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        pointsSpent: r.points_spent,
        rewardName: r.reward_name,
        createdAt: r.created_at,
        fulfilledAt: r.fulfilled_at,
      })),
    });
  }),
);

const updateMemberSchema = z.object({
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  status: z.enum(['active', 'blocked']).optional(),
});

/** Merchant-private CRM annotations. Never visible to the customer or to other tenants. */
membersRouter.patch(
  '/:id',
  requireStaffSession,
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const input = parseBody(updateMemberSchema, req);

    const updates: Record<string, unknown> = { updated_at: nowIso() };
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.tags !== undefined) updates.tags = JSON.stringify(input.tags);
    if (input.status !== undefined) updates.status = input.status;

    const updated = s.update<MembershipRow & Record<string, unknown>>('memberships', pathParam(req, 'id'), updates, 'Member');
    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'member.updated', entityType: 'membership', entityId: updated.id, ip: req.ip,
      meta: { fields: Object.keys(input) },
    });
    res.json({ member: shapeMemberRow(updated as Record<string, any>) });
  }),
);

const enrolSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(32).optional(),
});

/**
 * Sign a walk-in customer up at the counter.
 *
 * If the email already has a LoyaltyLoop identity we attach a membership to it
 * rather than creating a duplicate person — but the merchant learns nothing
 * about that identity beyond what they just typed in themselves.
 */
membersRouter.post(
  '/',
  requireStaffSession,
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const input = parseBody(enrolSchema, req);
    const merchant = getMerchant(s.merchantId);
    assertCapacity(s, 'members', getPlan(merchant.plan_code));

    const db = getDb();
    let customer = db.prepare(`SELECT id FROM customers WHERE email = ?`).get(input.email) as
      | { id: string }
      | undefined;

    if (!customer) {
      const id = newId('cus');
      const now = nowIso();
      // A counter sign-up gets a random password; the customer sets their own
      // when they download the app and use "forgot password".
      db.prepare(
        `INSERT INTO customers (id, email, phone, password_hash, name, status, created_at, updated_at)
         VALUES (@id, @email, @phone, @password_hash, @name, 'active', @now, @now)`,
      ).run({
        id,
        email: input.email,
        phone: input.phone ?? null,
        password_hash: await hashPassword(randomToken(24)),
        name: input.name,
        now,
      });
      customer = { id };
    }

    const existing = s.findBy('memberships', 'customer_id = @customerId', { customerId: customer.id });
    if (existing) throw conflict('That customer is already a member of your programme.');

    const membership = enrolCustomer(s, customer.id);
    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'member.enrolled', entityType: 'membership', entityId: membership.id, ip: req.ip,
    });

    res.status(201).json({
      member: shapeMemberRow({ ...membership, name: input.name, email: input.email, phone: input.phone ?? null }),
    });
  }),
);

/** CSV export so a merchant can always take their own customer list with them. */
membersRouter.get(
  '/export/csv',
  requireStaffSession,
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const rows = s.query<Record<string, any>>(
      `SELECT m.member_number, c.name, c.email, c.phone, m.points_balance, m.lifetime_points,
              m.visits, m.total_spend_cents, m.status, m.joined_at, m.last_activity_at, t.name AS tier_name
       FROM memberships m
       JOIN customers c ON c.id = m.customer_id
       LEFT JOIN tiers t ON t.id = m.tier_id
       WHERE m.merchant_id = @merchantId
       ORDER BY m.joined_at DESC`,
    );

    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'members.exported', entityType: 'membership', ip: req.ip, meta: { count: rows.length },
    });

    const header = [
      'member_number', 'name', 'email', 'phone', 'points_balance', 'lifetime_points',
      'visits', 'total_spend', 'tier', 'status', 'joined_at', 'last_activity_at',
    ];
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push([
        row.member_number, row.name, row.email, row.phone ?? '', row.points_balance, row.lifetime_points,
        row.visits, (row.total_spend_cents / 100).toFixed(2), row.tier_name ?? '', row.status,
        row.joined_at, row.last_activity_at ?? '',
      ].map(csvCell).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="members-${Date.now()}.csv"`);
    res.send(lines.join('\n'));
  }),
);

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  // Neutralise spreadsheet formula injection from customer-supplied names.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function shapeMemberRow(row: Record<string, any>) {
  return {
    id: row.id,
    memberNumber: row.member_number,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    pointsBalance: row.points_balance,
    lifetimePoints: row.lifetime_points,
    pointsRedeemed: row.points_redeemed,
    visits: row.visits,
    totalSpendCents: row.total_spend_cents,
    status: row.status,
    tierId: row.tier_id ?? null,
    tierName: row.tier_name ?? null,
    tierColor: row.tier_color ?? null,
    joinedAt: row.joined_at,
    lastActivityAt: row.last_activity_at,
  };
}

export function shapeLedgerRow(row: Record<string, any>) {
  return {
    id: row.id,
    type: row.type,
    pointsDelta: row.points_delta,
    balanceAfter: row.balance_after,
    amountCents: row.amount_cents,
    locationId: row.location_id,
    staffUserId: row.staff_user_id,
    source: row.source,
    reference: row.reference,
    note: row.note,
    items: JSON.parse(row.items ?? '[]'),
    createdAt: row.created_at,
  };
}
