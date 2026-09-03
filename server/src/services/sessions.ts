import { getDb } from '../db';
import { newId, randomToken, sha256 } from '../lib/ids';
import { addDays, nowIso } from '../lib/time';
import { config } from '../config';
import { unauthorized } from '../lib/errors';
import { signAccessToken, type MerchantRole, type PrincipalType } from '../lib/tokens';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RefreshRow {
  id: string;
  principal_type: PrincipalType;
  principal_id: string;
  merchant_id: string | null;
  expires_at: string;
  revoked_at: string | null;
}

export interface SessionSubject {
  id: string;
  type: PrincipalType;
  merchantId?: string | null;
  role?: MerchantRole;
  name?: string;
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export function issueSession(subject: SessionSubject, meta: RequestMeta = {}): IssuedSession {
  const db = getDb();
  const refreshToken = randomToken(48);
  db.prepare(
    `INSERT INTO refresh_tokens (id, token_hash, principal_type, principal_id, merchant_id,
                                 expires_at, user_agent, ip, created_at)
     VALUES (@id, @token_hash, @principal_type, @principal_id, @merchant_id,
             @expires_at, @user_agent, @ip, @created_at)`,
  ).run({
    id: newId('rt'),
    token_hash: sha256(refreshToken),
    principal_type: subject.type,
    principal_id: subject.id,
    merchant_id: subject.merchantId ?? null,
    expires_at: addDays(new Date(), config.refreshTokenTtlDays).toISOString(),
    user_agent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
    created_at: nowIso(),
  });

  const accessToken = signAccessToken({
    sub: subject.id,
    typ: subject.type,
    ...(subject.merchantId ? { mid: subject.merchantId } : {}),
    ...(subject.role ? { role: subject.role } : {}),
    ...(subject.name ? { name: subject.name } : {}),
  });

  return { accessToken, refreshToken, expiresIn: config.accessTokenTtlMinutes * 60 };
}

/**
 * Exchanges a refresh token for a new pair, rotating the old one.
 *
 * If a token that has already been rotated is presented again we treat it as a
 * stolen-token replay and revoke every live session for that principal, which
 * logs the attacker and the legitimate user out together.
 */
export function rotateSession(
  presentedToken: string,
  resolve: (row: RefreshRow) => SessionSubject | null,
  meta: RequestMeta = {},
): IssuedSession {
  const db = getDb();
  const hash = sha256(presentedToken);
  const row = db
    .prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`)
    .get(hash) as RefreshRow | undefined;

  if (!row) throw unauthorized('Session expired. Please sign in again.');

  if (row.revoked_at) {
    revokeAllForPrincipal(row.principal_type, row.principal_id);
    recordSecurityEvent({
      kind: 'refresh_token_reuse',
      principalType: row.principal_type,
      principalId: row.principal_id,
      merchantId: row.merchant_id,
      ip: meta.ip ?? null,
      detail: { revokedTokenId: row.id },
    });
    throw unauthorized('Session expired. Please sign in again.');
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw unauthorized('Session expired. Please sign in again.');
  }

  const subject = resolve(row);
  if (!subject) throw unauthorized('Session expired. Please sign in again.');

  const next = issueSession(subject, meta);
  db.prepare(`UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?`).run(
    nowIso(),
    sha256(next.refreshToken),
    row.id,
  );
  return next;
}

export function revokeSession(presentedToken: string): void {
  getDb()
    .prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .run(nowIso(), sha256(presentedToken));
}

export function revokeAllForPrincipal(type: PrincipalType, principalId: string): void {
  getDb()
    .prepare(
      `UPDATE refresh_tokens SET revoked_at = ?
       WHERE principal_type = ? AND principal_id = ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), type, principalId);
}

export function recordSecurityEvent(event: {
  kind: string;
  principalType?: string | null;
  principalId?: string | null;
  merchantId?: string | null;
  ip?: string | null;
  detail?: unknown;
}): void {
  getDb()
    .prepare(
      `INSERT INTO security_events (id, kind, principal_type, principal_id, merchant_id, ip, detail, created_at)
       VALUES (@id, @kind, @principal_type, @principal_id, @merchant_id, @ip, @detail, @created_at)`,
    )
    .run({
      id: newId('sec'),
      kind: event.kind,
      principal_type: event.principalType ?? null,
      principal_id: event.principalId ?? null,
      merchant_id: event.merchantId ?? null,
      ip: event.ip ?? null,
      detail: JSON.stringify(event.detail ?? {}),
      created_at: nowIso(),
    });
}

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

/** Shared brute-force lockout for `merchant_users` and `customers`. */
export function registerFailedLogin(table: 'merchant_users' | 'customers', id: string): void {
  const db = getDb();
  const row = db.prepare(`SELECT failed_attempts FROM ${table} WHERE id = ?`).get(id) as
    | { failed_attempts: number }
    | undefined;
  if (!row) return;
  const attempts = row.failed_attempts + 1;
  const lockedUntil =
    attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
  db.prepare(`UPDATE ${table} SET failed_attempts = ?, locked_until = ? WHERE id = ?`).run(
    lockedUntil ? 0 : attempts,
    lockedUntil,
    id,
  );
}

export function clearFailedLogins(table: 'merchant_users' | 'customers', id: string): void {
  getDb()
    .prepare(`UPDATE ${table} SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`)
    .run(nowIso(), id);
}

export function isLockedOut(lockedUntil: string | null): boolean {
  return Boolean(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
}
