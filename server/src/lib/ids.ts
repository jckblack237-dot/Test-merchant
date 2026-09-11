import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford-ish, no look-alikes

/** Cryptographically random, URL-safe id body. */
function randomBody(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export type IdPrefix =
  | 'mch' | 'usr' | 'cus' | 'mem' | 'loc' | 'prd' | 'rwd'
  | 'red' | 'txn' | 'tie' | 'cmp' | 'key' | 'aud' | 'sec' | 'rt' | 'adm'
  // AI Agent Island
  | 'msn' | 'run' | 'src' | 'vrf' | 'cor' | 'evt' | 'fup' | 'ias';

/**
 * Ids are random rather than sequential on purpose: in a multi-tenant system a
 * guessable id turns any missing authorisation check into a data breach. These
 * carry ~80 bits of entropy, so enumeration is not a viable attack even if a
 * check were ever missed.
 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBody(16)}`;
}

/** Human-facing member number shown in the app and read out at the counter. */
export function newMemberNumber(): string {
  const bytes = crypto.randomBytes(6);
  let digits = '';
  for (let i = 0; i < 6; i += 1) digits += (bytes[i]! % 10).toString();
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

/** Short redemption code the customer shows to staff. */
export function newRedemptionCode(): string {
  return randomBody(4).toUpperCase() + '-' + randomBody(4).toUpperCase();
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
