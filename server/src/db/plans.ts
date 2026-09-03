import type Database from 'better-sqlite3';

/**
 * The subscription catalogue the platform sells to merchants. Limits are
 * enforced at write time by requirePlanCapacity (middleware/subscription.ts);
 * -1 means unlimited.
 */
export const PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'For a single shop finding its regulars.',
    price_cents: 2900,
    currency: 'USD',
    interval: 'month',
    max_locations: 1,
    max_staff: 3,
    max_members: 500,
    is_public: 1,
    sort_order: 1,
    features: [
      '1 location',
      'Up to 500 loyalty members',
      '3 staff accounts',
      'Points, tiers and rewards',
      'Customer mobile app listing',
      'Email support',
    ],
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'For chains running several outlets and real campaigns.',
    price_cents: 7900,
    currency: 'USD',
    interval: 'month',
    max_locations: 10,
    max_staff: 25,
    max_members: 10000,
    is_public: 1,
    sort_order: 2,
    features: [
      'Up to 10 locations',
      'Up to 10,000 loyalty members',
      '25 staff accounts',
      'Campaigns and bonus multipliers',
      'POS API keys',
      'Full audit log',
      'Priority support',
    ],
  },
  {
    code: 'scale',
    name: 'Scale',
    description: 'For established brands with a national footprint.',
    price_cents: 19900,
    currency: 'USD',
    interval: 'month',
    max_locations: -1,
    max_staff: -1,
    max_members: -1,
    is_public: 1,
    sort_order: 3,
    features: [
      'Unlimited locations',
      'Unlimited members and staff',
      'Everything in Growth',
      'Custom tiers and expiry rules',
      'Dedicated onboarding',
      'SLA-backed support',
    ],
  },
] as const;

export function seedPlans(db: Database.Database): void {
  const stmt = db.prepare(`
    INSERT INTO plans (code, name, description, price_cents, currency, interval,
                       max_locations, max_staff, max_members, features, is_public, sort_order)
    VALUES (@code, @name, @description, @price_cents, @currency, @interval,
            @max_locations, @max_staff, @max_members, @features, @is_public, @sort_order)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      price_cents = excluded.price_cents,
      max_locations = excluded.max_locations,
      max_staff = excluded.max_staff,
      max_members = excluded.max_members,
      features = excluded.features,
      is_public = excluded.is_public,
      sort_order = excluded.sort_order
  `);
  const run = db.transaction(() => {
    for (const plan of PLANS) {
      stmt.run({ ...plan, features: JSON.stringify(plan.features) });
    }
  });
  run();
}
