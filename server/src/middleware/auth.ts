import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../db';
import { TenantStore } from '../db/tenant';
import { forbidden, notFound, unauthorized } from '../lib/errors';
import { verifyAccessToken, type MerchantRole } from '../lib/tokens';
import { recordSecurityEvent } from '../services/sessions';
import { sha256 } from '../lib/ids';
import { nowIso } from '../lib/time';

export interface MerchantPrincipal {
  kind: 'merchant_user' | 'api_key';
  userId: string | null;
  merchantId: string;
  role: MerchantRole;
  name: string;
  email?: string;
}

export interface CustomerPrincipal {
  customerId: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present after requireMerchantAuth. Carries the ONLY merchant id the request may touch. */
      merchant?: MerchantPrincipal;
      /** Merchant-locked database view. Built from the token, never from user input. */
      store?: TenantStore;
      customer?: CustomerPrincipal;
      admin?: { id: string; name: string };
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

const ROLE_RANK: Record<MerchantRole, number> = { staff: 1, manager: 2, owner: 3 };

/**
 * Authenticates a merchant staff member (or a POS API key) and pins the request
 * to their merchant.
 *
 * The merchant id comes from the signed token or the key record — never from a
 * path parameter, query string or body. Downstream handlers read data through
 * `req.store`, which cannot be pointed at another tenant.
 */
export function requireMerchantAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();

    if (token.startsWith('llk_')) {
      attachApiKeyPrincipal(req, token);
    } else {
      attachStaffPrincipal(req, token);
    }
    next();
  } catch (error) {
    next(error);
  }
}

function attachStaffPrincipal(req: Request, token: string): void {
  const claims = verifyAccessToken(token, 'merchant_user');
  if (!claims.mid) throw unauthorized();

  const db = getDb();
  const user = db
    .prepare(
      `SELECT id, merchant_id, email, name, role, status FROM merchant_users WHERE id = ?`,
    )
    .get(claims.sub) as
    | { id: string; merchant_id: string; email: string; name: string; role: MerchantRole; status: string }
    | undefined;

  if (!user || user.status !== 'active') throw unauthorized('This account is no longer active.');

  // The token says one merchant, the database says another: either the token was
  // tampered with or the account moved. Refuse and record it.
  if (user.merchant_id !== claims.mid) {
    recordSecurityEvent({
      kind: 'token_merchant_mismatch',
      principalType: 'merchant_user',
      principalId: user.id,
      merchantId: user.merchant_id,
      ip: req.ip,
      detail: { claimedMerchantId: claims.mid },
    });
    throw unauthorized();
  }

  const merchant = db
    .prepare(`SELECT id, status FROM merchants WHERE id = ?`)
    .get(user.merchant_id) as { id: string; status: string } | undefined;
  if (!merchant) throw unauthorized();
  if (merchant.status === 'suspended') {
    throw forbidden('This account has been suspended. Contact support to restore access.');
  }

  req.merchant = {
    kind: 'merchant_user',
    userId: user.id,
    merchantId: user.merchant_id,
    role: user.role,
    name: user.name,
    email: user.email,
  };
  req.store = new TenantStore(user.merchant_id, db);
}

function attachApiKeyPrincipal(req: Request, token: string): void {
  const db = getDb();
  const prefix = token.slice(0, 12);
  const candidates = db
    .prepare(`SELECT * FROM api_keys WHERE prefix = ? AND revoked_at IS NULL`)
    .all(prefix) as {
    id: string;
    merchant_id: string;
    name: string;
    key_hash: string;
  }[];

  const hash = sha256(token);
  const match = candidates.find((row) => row.key_hash === hash);
  if (!match) throw unauthorized('Invalid API key.');

  const merchant = db
    .prepare(`SELECT id, status FROM merchants WHERE id = ?`)
    .get(match.merchant_id) as { id: string; status: string } | undefined;
  if (!merchant || merchant.status === 'suspended') throw unauthorized('Invalid API key.');

  db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(nowIso(), match.id);

  req.merchant = {
    kind: 'api_key',
    userId: null,
    merchantId: match.merchant_id,
    // Keys are for point-of-sale automation: enough to award points, never
    // enough to manage staff, billing or the customer database.
    role: 'staff',
    name: `API key: ${match.name}`,
  };
  req.store = new TenantStore(match.merchant_id, db);
}

/** Requires a minimum role. Owner > manager > staff. */
export function requireRole(minimum: MerchantRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.merchant;
    if (!principal) return next(unauthorized());
    if (ROLE_RANK[principal.role] < ROLE_RANK[minimum]) {
      return next(forbidden(`This action requires the ${minimum} role.`));
    }
    next();
  };
}

/** Blocks POS API keys from endpoints meant for a signed-in human. */
export function requireStaffSession(req: Request, _res: Response, next: NextFunction): void {
  if (req.merchant?.kind !== 'merchant_user') {
    return next(forbidden('This endpoint requires a signed-in staff account.'));
  }
  next();
}

export function requireCustomerAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const claims = verifyAccessToken(token, 'customer');
    const row = getDb()
      .prepare(`SELECT id, name, status FROM customers WHERE id = ?`)
      .get(claims.sub) as { id: string; name: string; status: string } | undefined;
    if (!row || row.status !== 'active') throw unauthorized('This account is no longer active.');
    req.customer = { customerId: row.id, name: row.name };
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const claims = verifyAccessToken(token, 'platform_admin');
    const row = getDb()
      .prepare(`SELECT id, name, status FROM platform_admins WHERE id = ?`)
      .get(claims.sub) as { id: string; name: string; status: string } | undefined;
    if (!row || row.status !== 'active') throw unauthorized();
    req.admin = { id: row.id, name: row.name };
    next();
  } catch (error) {
    next(error);
  }
}

/** Convenience accessors that throw rather than returning undefined. */
export function store(req: Request): TenantStore {
  if (!req.store) throw unauthorized();
  return req.store;
}

export function merchantPrincipal(req: Request): MerchantPrincipal {
  if (!req.merchant) throw unauthorized();
  return req.merchant;
}

export function customerPrincipal(req: Request): CustomerPrincipal {
  if (!req.customer) throw unauthorized();
  return req.customer;
}

/**
 * Loads a membership for the signed-in customer, for a given merchant.
 * Used by the customer app; a customer may only ever address their own rows.
 */
export function customerMembershipOrFail(customerId: string, merchantId: string) {
  const row = getDb()
    .prepare(`SELECT * FROM memberships WHERE customer_id = ? AND merchant_id = ?`)
    .get(customerId, merchantId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('You have not joined this rewards programme yet.');
  return row;
}
