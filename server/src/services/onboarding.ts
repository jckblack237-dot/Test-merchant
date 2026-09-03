import { getDb } from '../db';
import { TenantStore } from '../db/tenant';
import { conflict } from '../lib/errors';
import { newId } from '../lib/ids';
import { addDays, nowIso } from '../lib/time';
import { slugify } from '../lib/validators';
import { hashPassword } from '../lib/passwords';
import { config } from '../config';

/** Starter tiers every new programme gets, so a merchant is useful on day one. */
const DEFAULT_TIERS = [
  { name: 'Member', min_lifetime_points: 0, multiplier: 1, color: '#94A3B8', perks: ['Earn points on every purchase'] },
  { name: 'Silver', min_lifetime_points: 500, multiplier: 1.25, color: '#64748B', perks: ['1.25x points', 'Birthday treat'] },
  { name: 'Gold', min_lifetime_points: 2000, multiplier: 1.5, color: '#D97706', perks: ['1.5x points', 'Free size upgrade', 'Early access to new drinks'] },
];

const DEFAULT_REWARDS = [
  { name: 'Free regular coffee', description: 'Any regular hot or iced coffee, on the house.', points_cost: 100, category: 'Drinks' },
  { name: 'Pastry of your choice', description: 'Pick anything from the pastry case.', points_cost: 150, category: 'Food' },
  { name: '$5 off your order', description: 'Five dollars off any order over $10.', points_cost: 250, category: 'Discounts' },
];

export function uniqueSlug(desired: string): string {
  const db = getDb();
  const base = slugify(desired);
  let candidate = base;
  let counter = 2;
  while (db.prepare(`SELECT 1 FROM merchants WHERE slug = ?`).get(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
    if (counter > 999) throw conflict('Could not allocate a unique address for that business name.');
  }
  return candidate;
}

export interface CreateMerchantInput {
  businessName: string;
  ownerName: string;
  email: string;
  password: string;
  planCode?: string;
  category?: string;
  currency?: string;
  country?: string;
}

export interface CreatedMerchant {
  merchantId: string;
  userId: string;
  slug: string;
}

/**
 * Self-serve signup: creates the tenant, its owner account, a starter tier
 * ladder and a small reward catalogue, all in one transaction so a half-built
 * merchant can never exist.
 */
export async function createMerchantAccount(input: CreateMerchantInput): Promise<CreatedMerchant> {
  const db = getDb();
  const email = input.email.toLowerCase();

  const emailTaken = db.prepare(`SELECT 1 FROM merchant_users WHERE email = ?`).get(email);
  if (emailTaken) {
    throw conflict('An account already exists for that email address.');
  }

  const passwordHash = await hashPassword(input.password);
  const slug = uniqueSlug(input.businessName);
  const merchantId = newId('mch');
  const userId = newId('usr');
  const now = nowIso();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO merchants (id, name, slug, tagline, description, category, brand_color, currency,
                              country, timezone, status, points_per_currency, signup_bonus_points,
                              plan_code, subscription_status, trial_ends_at, created_at, updated_at)
       VALUES (@id, @name, @slug, '', '', @category, '#0F766E', @currency,
               @country, 'UTC', 'active', 1, 50,
               @plan_code, 'trialing', @trial_ends_at, @now, @now)`,
    ).run({
      id: merchantId,
      name: input.businessName.trim(),
      slug,
      category: input.category ?? 'cafe',
      currency: input.currency ?? 'USD',
      country: input.country ?? 'US',
      plan_code: input.planCode ?? 'starter',
      trial_ends_at: addDays(new Date(), config.trialDays).toISOString(),
      now,
    });

    db.prepare(
      `INSERT INTO merchant_users (id, merchant_id, email, password_hash, name, role, status, created_at, updated_at)
       VALUES (@id, @merchant_id, @email, @password_hash, @name, 'owner', 'active', @now, @now)`,
    ).run({ id: userId, merchant_id: merchantId, email, password_hash: passwordHash, name: input.ownerName.trim(), now });

    const store = new TenantStore(merchantId, db);
    DEFAULT_TIERS.forEach((tier, index) => {
      store.insert('tiers', {
        id: newId('tie'),
        name: tier.name,
        min_lifetime_points: tier.min_lifetime_points,
        multiplier: tier.multiplier,
        color: tier.color,
        perks: JSON.stringify(tier.perks),
        sort_order: index,
        created_at: now,
        updated_at: now,
      });
    });
    DEFAULT_REWARDS.forEach((reward, index) => {
      store.insert('rewards', {
        id: newId('rwd'),
        name: reward.name,
        description: reward.description,
        points_cost: reward.points_cost,
        category: reward.category,
        stock: -1,
        per_member_limit: -1,
        is_active: 1,
        sort_order: index,
        created_at: now,
        updated_at: now,
      });
    });
    store.writeAudit({
      actorType: 'merchant_user',
      actorId: userId,
      actorLabel: input.ownerName,
      action: 'merchant.created',
      entityType: 'merchant',
      entityId: merchantId,
      meta: { plan: input.planCode ?? 'starter' },
    });
  })();

  return { merchantId, userId, slug };
}
