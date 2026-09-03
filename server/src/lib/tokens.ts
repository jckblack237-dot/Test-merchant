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
 * Short-lived token encoded in the customer's wallet QR code. Staff scan it to
 * award points; it expires quickly so a screenshot of someone's QR is not a
 * durable credential, and it is bound to the merchant whose programme it is for.
 */
export function signQrToken(membershipId: string, merchantId: string, ttlSeconds = 120): string {
  const payload = { mem: membershipId, mid: merchantId };
  return jwt.sign(payload, config.qrTokenSecret, {
    expiresIn: ttlSeconds,
    issuer: ISSUER,
    audience: 'wallet-qr',
  });
}

export function verifyQrToken(token: string): { mem: string; mid: string } {
  try {
    const decoded = jwt.verify(token, config.qrTokenSecret, {
      issuer: ISSUER,
      audience: 'wallet-qr',
      algorithms: ['HS256'],
    }) as { mem: string; mid: string };
    return decoded;
  } catch {
    throw unauthorized('This QR code has expired. Ask the customer to refresh their wallet.');
  }
}
