import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config';
import { unauthorized } from './errors';

export type PrincipalType = 'merchant_user' | 'customer' | 'platform_admin';
export type MerchantRole = 'owner' | 'manager' | 'staff';

export interface AccessTokenClaims {
  sub: string;
  typ: PrincipalType;
  /** Merchant the token is bound to. Present only for merchant_user tokens. */
  mid?: string;
  role?: MerchantRole;
  name?: string;
}

const ISSUER = 'loyaltyloop';

export function signAccessToken(claims: AccessTokenClaims): string {
  const options: SignOptions = {
    expiresIn: `${config.accessTokenTtlMinutes}m`,
    issuer: ISSUER,
    audience: claims.typ,
    jwtid: crypto.randomUUID(),
  };
  return jwt.sign(claims, config.accessTokenSecret, options);
}

export function verifyAccessToken(token: string, expected: PrincipalType): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, config.accessTokenSecret, {
      issuer: ISSUER,
      audience: expected,
      algorithms: ['HS256'],
    }) as AccessTokenClaims;
    if (decoded.typ !== expected) throw new Error('principal type mismatch');
    return decoded;
  } catch {
    throw unauthorized('Your session is invalid or has expired. Please sign in again.');
  }
}

/**
 * Short-lived token encoded in the customer's wallet QR code.
 *
 * Deliberately not a JWT: a JWT is ~240 characters, which pushes the QR to a
 * dense grid that scans badly on a phone screen held over a till scanner. This
 * is `<membershipId>.<expiry>.<truncated HMAC>` — about 50 characters, roughly
 * a third of the modules, and far quicker to scan.
 *
 * The signature is a 96-bit truncated HMAC-SHA256. That is ample for a token
 * that lives two minutes: forging one would take ~2^96 guesses against a value
 * that has already expired.
 *
 * The token does not name a merchant, and does not need to. Staff resolve it
 * through their tenant-scoped store, so a code minted for another shop's
 * programme simply finds no member here.
 */
const QR_SIG_LENGTH = 16; // base64url chars = 96 bits

function qrSignature(membershipId: string, expiresAt: number): string {
  return crypto
    .createHmac('sha256', config.qrTokenSecret)
    .update(`${membershipId}.${expiresAt}`)
    .digest('base64url')
    .slice(0, QR_SIG_LENGTH);
}

export function signQrToken(membershipId: string, ttlSeconds = 120): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${membershipId}.${expiresAt.toString(36)}.${qrSignature(membershipId, expiresAt)}`;
}

export function verifyQrToken(token: string): { membershipId: string } {
  const expired = () =>
    unauthorized('This code has expired. Ask the customer to refresh their wallet.');

  const parts = token.split('.');
  if (parts.length !== 3) throw expired();
  const [membershipId, expBase36, signature] = parts as [string, string, string];

  const expiresAt = Number.parseInt(expBase36, 36);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) throw expired();

  const expected = Buffer.from(qrSignature(membershipId, expiresAt));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    throw expired();
  }

  return { membershipId };
}
