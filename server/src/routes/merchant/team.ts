import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors';
import { merchantPrincipal, requireRole, requireStaffSession, store } from '../../middleware/auth';
import { parseBody, pathParam } from '../../middleware/validate';
import { requireActiveSubscription } from '../../middleware/subscription';
import { assertCapacity, getMerchant, getPlan } from '../../services/subscriptions';
import { badRequest, conflict } from '../../lib/errors';
import { getDb } from '../../db';
import { newId, randomToken, sha256 } from '../../lib/ids';
import { nowIso } from '../../lib/time';
import { hashPassword } from '../../lib/passwords';
import { emailSchema, nameSchema, passwordSchema } from '../../lib/validators';
import { revokeAllForPrincipal } from '../../services/sessions';

export const teamRouter = Router();
teamRouter.use(requireStaffSession);

const shapeUser = (row: Record<string, any>) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  status: row.status,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
});

teamRouter.get(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    res.json({
      team: s
        .list('merchant_users', {
          columns: 'id, name, email, role, status, last_login_at, created_at',
          orderBy: `CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name`,
        })
        .map(shapeUser),
    });
  }),
);

const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['owner', 'manager', 'staff']).default('staff'),
});

/**
 * Adds a staff account. Owner-only: the ability to mint logins for a tenant is
 * the most sensitive permission in the product.
 */
teamRouter.post(
  '/',
  requireRole('owner'),
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const input = parseBody(createUserSchema, req);
    const merchant = getMerchant(s.merchantId);
    assertCapacity(s, 'staff', getPlan(merchant.plan_code));

    const db = getDb();
    if (db.prepare(`SELECT 1 FROM merchant_users WHERE email = ?`).get(input.email)) {
      throw conflict('An account already exists for that email address.');
    }

    const now = nowIso();
    const user = s.insert('merchant_users', {
      id: newId('usr'),
      email: input.email,
      password_hash: await hashPassword(input.password),
      name: input.name,
      role: input.role,
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'team.member_added', entityType: 'merchant_user', entityId: String(user.id), ip: req.ip,
      meta: { role: input.role },
    });

    res.status(201).json({ user: shapeUser(user) });
  }),
);

const updateUserSchema = z.object({
  name: nameSchema.optional(),
  role: z.enum(['owner', 'manager', 'staff']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: passwordSchema.optional(),
});

teamRouter.patch(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const input = parseBody(updateUserSchema, req);
    const target = s.findOrFail<Record<string, any>>('merchant_users', pathParam(req, 'id'), 'Team member');

    // Guard against a tenant locking itself out of its own account.
    if ((input.role && input.role !== 'owner') || input.status === 'disabled') {
      const activeOwners = s.count('merchant_users', `role = 'owner' AND status = 'active'`);
      if (target.role === 'owner' && activeOwners <= 1) {
        throw badRequest('This is your only active owner. Promote someone else first.');
      }
    }

    const updates: Record<string, unknown> = { updated_at: nowIso() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.role !== undefined) updates.role = input.role;
    if (input.status !== undefined) updates.status = input.status;
    if (input.password !== undefined) updates.password_hash = await hashPassword(input.password);

    const user = s.update('merchant_users', pathParam(req, 'id'), updates, 'Team member');

    // A revoked or demoted account must not keep an access token alive.
    if (input.status === 'disabled' || input.role !== undefined || input.password !== undefined) {
      revokeAllForPrincipal('merchant_user', String(user.id));
    }

    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'team.member_updated', entityType: 'merchant_user', entityId: String(user.id), ip: req.ip,
      meta: { fields: Object.keys(input) },
    });

    res.json({ user: shapeUser(user) });
  }),
);

teamRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    if (pathParam(req, 'id') === principal.userId) throw badRequest('You cannot remove your own account.');

    const target = s.findOrFail<Record<string, any>>('merchant_users', pathParam(req, 'id'), 'Team member');
    if (target.role === 'owner') {
      const activeOwners = s.count('merchant_users', `role = 'owner' AND status = 'active'`);
      if (activeOwners <= 1) throw badRequest('This is your only active owner.');
    }

    s.delete('merchant_users', pathParam(req, 'id'), 'Team member');
    revokeAllForPrincipal('merchant_user', pathParam(req, 'id'));
    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'team.member_removed', entityType: 'merchant_user', entityId: pathParam(req, 'id'), ip: req.ip,
    });
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// POS API keys
// ---------------------------------------------------------------------------

export const apiKeysRouter = Router();
apiKeysRouter.use(requireStaffSession, requireRole('owner'));

apiKeysRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const s = store(req);
    res.json({
      keys: s
        .list('api_keys', { orderBy: 'created_at DESC' })
        .map((row: Record<string, any>) => ({
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          scopes: JSON.parse(row.scopes ?? '[]'),
          lastUsedAt: row.last_used_at,
          revokedAt: row.revoked_at,
          createdAt: row.created_at,
        })),
    });
  }),
);

/**
 * Issues a POS key. The full secret is returned exactly once and only the
 * SHA-256 hash is stored, so a database leak does not hand over live keys.
 */
apiKeysRouter.post(
  '/',
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const { name } = parseBody(z.object({ name: nameSchema }), req);

    const secret = `llk_${randomToken(24)}`;
    const now = nowIso();
    const row = s.insert('api_keys', {
      id: newId('key'),
      name,
      prefix: secret.slice(0, 12),
      key_hash: sha256(secret),
      scopes: JSON.stringify(['points:write', 'members:read']),
      created_by: principal.userId,
      created_at: now,
      updated_at: now,
    });

    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'api_key.created', entityType: 'api_key', entityId: String(row.id), ip: req.ip,
    });

    res.status(201).json({
      key: { id: row.id, name, prefix: row.prefix, createdAt: now },
      secret,
      warning: 'Copy this key now. For your security it is never shown again.',
    });
  }),
);

apiKeysRouter.post(
  '/:id/revoke',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    s.update('api_keys', pathParam(req, 'id'), { revoked_at: nowIso(), updated_at: nowIso() }, 'API key');
    s.writeAudit({
      actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
      action: 'api_key.revoked', entityType: 'api_key', entityId: pathParam(req, 'id'), ip: req.ip,
    });
    res.status(204).end();
  }),
);
