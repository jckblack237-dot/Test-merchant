import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const DEV_FALLBACKS: Record<string, string> = {
  ACCESS_TOKEN_SECRET: 'dev-only-access-secret-change-me-0123456789abcdef',
  REFRESH_TOKEN_SECRET: 'dev-only-refresh-secret-change-me-0123456789abcdef',
  QR_TOKEN_SECRET: 'dev-only-qr-secret-change-me-0123456789abcdef',
};

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

/**
 * Reads a secret from the environment.
 *
 * Outside production we fall back to a well-known development value so that
 * `git clone && npm run dev` works. In production a missing or short secret is
 * a hard boot failure — shipping a SaaS with a default signing key would let
 * anyone mint a token for any merchant.
 */
function requireSecret(name: keyof typeof DEV_FALLBACKS): string {
  const value = process.env[name];
  if (!value || value.length < 32) {
    if (isProduction) {
      throw new Error(
        `${name} must be set to at least 32 characters in production. Generate one with: openssl rand -hex 48`,
      );
    }
    return DEV_FALLBACKS[name]!;
  }
  if (isProduction && value === DEV_FALLBACKS[name]) {
    throw new Error(`${name} is still set to the development default. Refusing to start in production.`);
  }
  return value;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const rawDatabasePath = process.env.DATABASE_PATH;
const databasePath =
  rawDatabasePath === ':memory:'
    ? ':memory:'
    : rawDatabasePath
      ? path.resolve(process.cwd(), rawDatabasePath)
      : path.resolve(__dirname, '..', 'data', 'loyaltyloop.sqlite');

if (databasePath !== ':memory:') {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}

export const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: intFromEnv('PORT', 4000),
  databasePath,
  accessTokenSecret: requireSecret('ACCESS_TOKEN_SECRET'),
  refreshTokenSecret: requireSecret('REFRESH_TOKEN_SECRET'),
  qrTokenSecret: requireSecret('QR_TOKEN_SECRET'),
  accessTokenTtlMinutes: intFromEnv('ACCESS_TOKEN_TTL_MINUTES', 30),
  refreshTokenTtlDays: intFromEnv('REFRESH_TOKEN_TTL_DAYS', 30),
  trialDays: intFromEnv('TRIAL_DAYS', 14),
  bcryptRounds: intFromEnv('BCRYPT_ROUNDS', nodeEnv === 'test' ? 4 : 12),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;
