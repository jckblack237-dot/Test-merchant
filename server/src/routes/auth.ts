import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { asyncHandler } from '../middleware/errors';
import { authLimiter, signupLimiter } from '../middleware/rateLimit';
import { parseBody } from '../middleware/validate';
import { badRequest, conflict, unauthorized } from '../lib/errors';
import { emailSchema, nameSchema, passwordSchema } from '../lib/validators';
import { burnPasswordTime, hashPassword, verifyPassword } from '../lib/passwords';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';
import { createMerchantAccount } from '../services/onboarding';
import {
  clearFailedLogins, isLockedOut, issueSession, recordSecurityEvent,
  registerFailedLogin, revokeSession, rotateSession,
} from '../services/sessions';
import { getMerchant, subscriptionState } from '../services/subscriptions';
import { requireCustomerAuth, requireMerchantAuth } from '../middleware/auth';

export const authRouter = Router();

const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

function requestMeta(req: { ip?: string; header: (n: string) => string | undefined }) {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

// ---------------------------------------------------------------------------
// Merchant (CRM) authentication
// ---------------------------------------------------------------------------

const merchantSignupSchema = z.object({
  businessName: nameSchema,
  ownerName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  planCode: z.enum(['starter', 'growth', 'scale']).default('starter'),
  category: z.string().trim().max(40).default('cafe'),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  country: z.string().trim().length(2).toUpperCase().default('US'),
});

authRouter.post(
  '/merchant/signup',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(merchantSignupSchema, req);
    const created = await createMerchantAccount(input);
    const session = issueSession(
      { id: created.userId, type: 'merchant_user', merchantId: created.merchantId, role: 'owner', name: input.ownerName },
      requestMeta(req),
    );
    const merchant = getMerchant(created.merchantId);
    res.status(201).json({
      ...session,
      user: { id: created.userId, name: input.ownerName, email: input.email, role: 'owner' },
      merchant: publicMerchantShape(merchant),
      subscription: subscriptionState(merchant),
    });
  }),
);

authRouter.post(
  '/merchant/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parseBody(credentialsSchema, req);
    const db = getDb();
    const user = db
      .prepare(`SELECT * FROM merchant_users WHERE email = ?`)
      .get(email) as Record<string, any> | undefined;

    if (!user) {
      await burnPasswordTime();
      recordSecurityEvent({ kind: 'login_unknown_email', principalType: 'merchant_user', ip: req.ip, detail: { email } });
      throw unauthorized('Email or password is incorrect.');
    }
    if (isLockedOut(user.locked_until)) {
      throw unauthorized('Too many failed attempts. Try again in a few minutes.');
    }
    if (user.status !== 'active') throw unauthorized('This account has been disabled.');

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      registerFailedLogin('merchant_users', user.id);
      recordSecurityEvent({
        kind: 'login_failed', principalType: 'merchant_user', principalId: user.id,
        merchantId: user.merchant_id, ip: req.ip,
      });
      throw unauthorized('Email or password is incorrect.');
    }

    const merchant = getMerchant(user.merchant_id);
    if (merchant.status === 'suspended') {
      throw unauthorized('This account has been suspended. Contact support.');
    }

    clearFailedLogins('merchant_users', user.id);
    const session = issueSession(
      { id: user.id, type: 'merchant_user', merchantId: user.merchant_id, role: user.role, name: user.name },
      requestMeta(req),
    );
    res.json({
      ...session,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      merchant: publicMerchantShape(merchant),
      subscription: subscriptionState(merchant),
    });
  }),
);

authRouter.post(
  '/merchant/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = parseBody(z.object({ refreshToken: z.string().min(10) }), req);
    const db = getDb();
    const session = rotateSession(
      refreshToken,
      (row) => {
        if (row.principal_type !== 'merchant_user') return null;
        const user = db
          .prepare(`SELECT id, merchant_id, name, role, status FROM merchant_users WHERE id = ?`)
          .get(row.principal_id) as Record<string, any> | undefined;
        if (!user || user.status !== 'active') return null;
        return { id: user.id, type: 'merchant_user', merchantId: user.merchant_id, role: user.role, name: user.name };
      },
      requestMeta(req),
    );
    res.json(session);
  }),
);

authRouter.post(
  '/merchant/logout',
  asyncHandler(async (req, res) => {
    const { refreshToken } = parseBody(z.object({ refreshToken: z.string().min(10) }), req);
    revokeSession(refreshToken);
    res.status(204).end();
  }),
);

authRouter.get(
  '/merchant/me',
  requireMerchantAuth,
  asyncHandler(async (req, res) => {
    const principal = req.merchant!;
    const merchant = getMerchant(principal.merchantId);
    res.json({
      user: { id: principal.userId, name: principal.name, email: principal.email, role: principal.role },
      merchant: publicMerchantShape(merchant),
      subscription: subscriptionState(merchant),
    });
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

authRouter.post(
  '/merchant/change-password',
  requireMerchantAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const principal = req.merchant!;
    if (principal.kind !== 'merchant_user' || !principal.userId) {
      throw badRequest('API keys cannot change passwords.');
    }
    const { currentPassword, newPassword } = parseBody(changePasswordSchema, req);
    const db = getDb();
    const user = db
      .prepare(`SELECT id, password_hash FROM merchant_users WHERE id = ?`)
      .get(principal.userId) as { id: string; password_hash: string };
    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      throw unauthorized('Your current password is incorrect.');
    }
    db.prepare(`UPDATE merchant_users SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .run(await hashPassword(newPassword), nowIso(), user.id);
    req.store!.writeAudit({
      actorType: 'merchant_user', actorId: user.id, actorLabel: principal.name,
      action: 'user.password_changed', entityType: 'merchant_user', entityId: user.id, ip: req.ip,
    });
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Customer authentication
// ---------------------------------------------------------------------------

const customerSignupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().trim().max(32).optional(),
  marketingOptIn: z.boolean().default(false),
});

authRouter.post(
  '/customer/signup',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(customerSignupSchema, req);
    const db = getDb();
    if (db.prepare(`SELECT 1 FROM customers WHERE email = ?`).get(input.email)) {
      throw conflict('An account already exists for that email address. Try signing in.');
    }
    const id = newId('cus');
    const now = nowIso();
    db.prepare(
      `INSERT INTO customers (id, email, phone, password_hash, name, marketing_opt_in, status, created_at, updated_at)
       VALUES (@id, @email, @phone, @password_hash, @name, @marketing_opt_in, 'active', @now, @now)`,
    ).run({
      id,
      email: input.email,
      phone: input.phone ?? null,
      password_hash: await hashPassword(input.password),
      name: input.name,
      marketing_opt_in: input.marketingOptIn ? 1 : 0,
      now,
    });
    const session = issueSession({ id, type: 'customer', name: input.name }, requestMeta(req));
    res.status(201).json({
      ...session,
      customer: { id, name: input.name, email: input.email, phone: input.phone ?? null },
    });
  }),
);

authRouter.post(
  '/customer/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parseBody(credentialsSchema, req);
    const db = getDb();
    const customer = db.prepare(`SELECT * FROM customers WHERE email = ?`).get(email) as
      | Record<string, any>
      | undefined;

    if (!customer) {
      await burnPasswordTime();
      throw unauthorized('Email or password is incorrect.');
    }
    if (isLockedOut(customer.locked_until)) {
      throw unauthorized('Too many failed attempts. Try again in a few minutes.');
    }
    if (customer.status !== 'active') throw unauthorized('This account has been disabled.');
    if (!(await verifyPassword(password, customer.password_hash))) {
      registerFailedLogin('customers', customer.id);
      recordSecurityEvent({ kind: 'login_failed', principalType: 'customer', principalId: customer.id, ip: req.ip });
      throw unauthorized('Email or password is incorrect.');
    }

    clearFailedLogins('customers', customer.id);
    const session = issueSession({ id: customer.id, type: 'customer', name: customer.name }, requestMeta(req));
    res.json({
      ...session,
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
    });
  }),
);

authRouter.post(
  '/customer/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = parseBody(z.object({ refreshToken: z.string().min(10) }), req);
    const db = getDb();
    const session = rotateSession(
      refreshToken,
      (row) => {
        if (row.principal_type !== 'customer') return null;
        const customer = db
          .prepare(`SELECT id, name, status FROM customers WHERE id = ?`)
          .get(row.principal_id) as Record<string, any> | undefined;
        if (!customer || customer.status !== 'active') return null;
        return { id: customer.id, type: 'customer', name: customer.name };
      },
      requestMeta(req),
    );
    res.json(session);
  }),
);

authRouter.post(
  '/customer/logout',
  asyncHandler(async (req, res) => {
    const { refreshToken } = parseBody(z.object({ refreshToken: z.string().min(10) }), req);
    revokeSession(refreshToken);
    res.status(204).end();
  }),
);

authRouter.get(
  '/customer/me',
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const customer = db
      .prepare(`SELECT id, name, email, phone, avatar_url, marketing_opt_in FROM customers WHERE id = ?`)
      .get(req.customer!.customerId);
    res.json({ customer });
  }),
);

export function publicMerchantShape(merchant: Record<string, any>) {
  return {
    id: merchant.id,
    name: merchant.name,
    slug: merchant.slug,
    tagline: merchant.tagline,
    description: merchant.description,
    category: merchant.category,
    logoUrl: merchant.logo_url,
    coverUrl: merchant.cover_url,
    brandColor: merchant.brand_color,
    currency: merchant.currency,
    country: merchant.country,
    pointsPerCurrency: merchant.points_per_currency,
    signupBonusPoints: merchant.signup_bonus_points,
    pointsExpiryDays: merchant.points_expiry_days,
    isListed: Boolean(merchant.is_listed),
    planCode: merchant.plan_code,
    subscriptionStatus: merchant.subscription_status,
    trialEndsAt: merchant.trial_ends_at,
    createdAt: merchant.created_at,
  };
}
