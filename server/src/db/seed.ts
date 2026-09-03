/**
 * Demo seed.
 *
 * Creates TWO competing coffee chains on purpose. The whole point of the
 * product is that neither can see the other's customers, so the demo data has
 * to make that visible: sign in as either merchant and you get your own
 * dashboard, your own member list, your own audit trail.
 *
 *   npm run seed            # keeps existing data, adds demo tenants
 *   npm run seed -- --reset # wipes the database first
 */
import fs from 'node:fs';
import { config } from '../config';
import { getDb, setDb, openDatabase } from './index';
import { TenantStore } from './tenant';
import { createMerchantAccount } from '../services/onboarding';
import { awardPoints, enrolCustomer, redeemReward } from '../services/loyalty';
import { hashPassword } from '../lib/passwords';
import { newId } from '../lib/ids';
import { nowIso, addDays } from '../lib/time';

const RESET = process.argv.includes('--reset');

const CUSTOMERS = [
  { name: 'Aisha Rahman', email: 'aisha@example.com' },
  { name: 'Ben Carter', email: 'ben@example.com' },
  { name: 'Chen Wei', email: 'chen@example.com' },
  { name: 'Diana Okafor', email: 'diana@example.com' },
  { name: 'Eli Moreau', email: 'eli@example.com' },
  { name: 'Farah Nasser', email: 'farah@example.com' },
  { name: 'Grace Lim', email: 'grace@example.com' },
  { name: 'Hugo Santos', email: 'hugo@example.com' },
  { name: 'Ivy Tan', email: 'ivy@example.com' },
  { name: 'Jonas Berg', email: 'jonas@example.com' },
  { name: 'Kiara Patel', email: 'kiara@example.com' },
  { name: 'Liam Murphy', email: 'liam@example.com' },
];

const DEMO_PASSWORD = 'demo12345';

interface ChainSpec {
  businessName: string;
  ownerName: string;
  email: string;
  planCode: 'starter' | 'growth' | 'scale';
  brandColor: string;
  tagline: string;
  description: string;
  pointsPerCurrency: number;
  locations: { name: string; address: string; city: string; hours: string; lat: number; lng: number }[];
  products: { name: string; description: string; category: string; price: number; featured?: boolean }[];
  rewards: { name: string; description: string; cost: number; category: string }[];
  staff: { name: string; email: string; role: 'manager' | 'staff' }[];
  campaign?: { name: string; description: string; multiplier: number; minSpend: number };
  customerSlice: [number, number];
}

const CHAINS: ChainSpec[] = [
  {
    businessName: 'Zuz Coffee',
    ownerName: 'Nadia Haq',
    email: 'owner@zuzcoffee.test',
    planCode: 'growth',
    brandColor: '#0F766E',
    tagline: 'Specialty coffee, every corner.',
    description:
      'A fast-growing specialty coffee chain. Earn a point for every dollar, climb from Member to Gold, and swap points for drinks and pastries.',
    pointsPerCurrency: 1,
    locations: [
      { name: 'Zuz Central Station', address: '1 Station Plaza', city: 'Kuala Lumpur', hours: 'Mon-Sun 7:00-21:00', lat: 3.1390, lng: 101.6869 },
      { name: 'Zuz Riverside', address: '88 River Walk', city: 'Kuala Lumpur', hours: 'Mon-Sun 8:00-22:00', lat: 3.1478, lng: 101.6953 },
      { name: 'Zuz Airport T2', address: 'Terminal 2, Level 3', city: 'Sepang', hours: 'Daily 5:00-23:00', lat: 2.7456, lng: 101.7099 },
    ],
    products: [
      { name: 'Flat White', description: 'Double ristretto, silky microfoam.', category: 'Coffee', price: 450, featured: true },
      { name: 'Iced Latte', description: 'House blend over ice.', category: 'Coffee', price: 490, featured: true },
      { name: 'Cold Brew', description: 'Steeped 18 hours, no bitterness.', category: 'Coffee', price: 520 },
      { name: 'Cappuccino', description: 'Classic, generous foam.', category: 'Coffee', price: 430 },
      { name: 'Matcha Latte', description: 'Ceremonial grade, lightly sweet.', category: 'Tea', price: 560 },
      { name: 'Butter Croissant', description: 'Baked each morning on site.', category: 'Bakery', price: 380 },
      { name: 'Almond Danish', description: 'Frangipane and toasted almonds.', category: 'Bakery', price: 420 },
      { name: 'Egg & Cheese Bagel', description: 'Warm, folded egg, aged cheddar.', category: 'Food', price: 690 },
    ],
    rewards: [
      { name: 'Free regular coffee', description: 'Any regular hot or iced coffee.', cost: 100, category: 'Drinks' },
      { name: 'Pastry of your choice', description: 'Anything from the pastry case.', cost: 150, category: 'Food' },
      { name: 'Free size upgrade', description: 'Go large on any drink, on us.', cost: 60, category: 'Drinks' },
      { name: 'RM20 off your order', description: 'Twenty off any order over RM40.', cost: 250, category: 'Discounts' },
      { name: 'Bag of beans (250g)', description: 'Take our house blend home.', cost: 600, category: 'Retail' },
    ],
    staff: [
      { name: 'Marcus Ooi', email: 'marcus@zuzcoffee.test', role: 'manager' },
      { name: 'Priya Selvam', email: 'priya@zuzcoffee.test', role: 'staff' },
    ],
    campaign: { name: 'Double Point Tuesdays', description: '2x points all day every Tuesday.', multiplier: 2, minSpend: 0 },
    customerSlice: [0, 9],
  },
  {
    businessName: 'Bloom Bakehouse',
    ownerName: 'Tomas Lind',
    email: 'owner@bloombakehouse.test',
    planCode: 'starter',
    brandColor: '#B45309',
    tagline: 'Sourdough, pastry, and very good butter.',
    description:
      'A neighbourhood bakehouse running a simple stamp-style rewards programme. Every loaf counts toward the next one free.',
    pointsPerCurrency: 2,
    locations: [
      { name: 'Bloom Bakehouse — Old Town', address: '14 Mill Lane', city: 'Kuala Lumpur', hours: 'Tue-Sun 7:30-17:00', lat: 3.1421, lng: 101.6957 },
    ],
    products: [
      { name: 'Country Sourdough', description: '48-hour ferment, 1kg loaf.', category: 'Bread', price: 1200, featured: true },
      { name: 'Cardamom Bun', description: 'The one people queue for.', category: 'Pastry', price: 520, featured: true },
      { name: 'Pain au Chocolat', description: 'Two batons of dark chocolate.', category: 'Pastry', price: 480 },
      { name: 'Focaccia Slab', description: 'Rosemary and sea salt.', category: 'Bread', price: 800 },
      { name: 'Filter Coffee', description: 'Rotating single origin.', category: 'Drinks', price: 350 },
    ],
    rewards: [
      { name: 'Free cardamom bun', description: 'Our most-requested pastry.', cost: 120, category: 'Pastry' },
      { name: 'Free sourdough loaf', description: 'A whole 1kg country loaf.', cost: 300, category: 'Bread' },
      { name: 'Free filter coffee', description: 'Any size, any origin.', cost: 80, category: 'Drinks' },
    ],
    staff: [{ name: 'Rosa Iqbal', email: 'rosa@bloombakehouse.test', role: 'staff' }],
    customerSlice: [6, 12],
  },
];

async function ensureCustomers(): Promise<{ id: string; name: string; email: string }[]> {
  const db = getDb();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const created: { id: string; name: string; email: string }[] = [];

  for (const person of CUSTOMERS) {
    const existing = db.prepare(`SELECT id FROM customers WHERE email = ?`).get(person.email) as
      | { id: string }
      | undefined;
    if (existing) {
      created.push({ ...person, id: existing.id });
      continue;
    }
    const id = newId('cus');
    const now = nowIso();
    db.prepare(
      `INSERT INTO customers (id, email, phone, password_hash, name, marketing_opt_in, status, created_at, updated_at)
       VALUES (@id, @email, NULL, @hash, @name, 1, 'active', @now, @now)`,
    ).run({ id, email: person.email, hash: passwordHash, name: person.name, now });
    created.push({ ...person, id });
  }
  return created;
}

/** Deterministic pseudo-randomness so reruns produce comparable dashboards. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

async function buildChain(spec: ChainSpec, customers: { id: string; name: string; email: string }[]) {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM merchants WHERE name = ?`).get(spec.businessName) as
    | { id: string }
    | undefined;
  if (existing) {
    console.log(`  ${spec.businessName} already exists — skipping.`);
    return;
  }

  const { merchantId } = await createMerchantAccount({
    businessName: spec.businessName,
    ownerName: spec.ownerName,
    email: spec.email,
    password: DEMO_PASSWORD,
    planCode: spec.planCode,
    currency: 'MYR',
    country: 'MY',
  });

  const store = new TenantStore(merchantId);
  const now = nowIso();

  db.prepare(
    `UPDATE merchants SET tagline = ?, description = ?, brand_color = ?, points_per_currency = ?,
       subscription_status = 'active', trial_ends_at = NULL, current_period_end = ?, updated_at = ?
     WHERE id = ?`,
  ).run(spec.tagline, spec.description, spec.brandColor, spec.pointsPerCurrency,
        addDays(new Date(), 30).toISOString(), now, merchantId);

  const staffPasswordHash = await hashPassword(DEMO_PASSWORD);
  for (const member of spec.staff) {
    store.insert('merchant_users', {
      id: newId('usr'),
      email: member.email,
      password_hash: staffPasswordHash,
      name: member.name,
      role: member.role,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  }

  const locationIds = spec.locations.map((location) =>
    String(
      store.insert('locations', {
        id: newId('loc'),
        name: location.name,
        address_line1: location.address,
        city: location.city,
        region: '',
        postcode: '',
        country: 'Malaysia',
        lat: location.lat,
        lng: location.lng,
        phone: '+60 3-1234 5678',
        opening_hours: location.hours,
        is_active: 1,
        created_at: now,
        updated_at: now,
      }).id,
    ),
  );

  const productIds = spec.products.map((product, index) =>
    String(
      store.insert('products', {
        id: newId('prd'),
        name: product.name,
        description: product.description,
        category: product.category,
        price_cents: product.price,
        is_active: 1,
        is_featured: product.featured ? 1 : 0,
        sort_order: index,
        created_at: now,
        updated_at: now,
      }).id,
    ),
  );

  // Replace the generic starter rewards with this brand's own catalogue.
  for (const reward of store.list('rewards')) store.delete('rewards', String(reward.id));
  const rewardIds = spec.rewards.map((reward, index) =>
    String(
      store.insert('rewards', {
        id: newId('rwd'),
        name: reward.name,
        description: reward.description,
        points_cost: reward.cost,
        category: reward.category,
        stock: -1,
        per_member_limit: -1,
        is_active: 1,
        sort_order: index,
        created_at: now,
        updated_at: now,
      }).id,
    ),
  );

  if (spec.campaign) {
    store.insert('campaigns', {
      id: newId('cmp'),
      name: spec.campaign.name,
      description: spec.campaign.description,
      type: 'multiplier',
      multiplier: spec.campaign.multiplier,
      bonus_points: 0,
      min_spend_cents: spec.campaign.minSpend,
      location_id: null,
      starts_at: null,
      ends_at: null,
      is_active: 1,
      created_at: now,
      updated_at: now,
    });
  }

  // Enrol members and back-fill a few weeks of purchase history.
  const slice = customers.slice(spec.customerSlice[0], spec.customerSlice[1]);
  const random = seededRandom(spec.businessName.length * 7919);

  for (const [memberIndex, person] of slice.entries()) {
    const membership = enrolCustomer(store, person.id);
    const visits = 3 + Math.floor(random() * 18);

    for (let visit = 0; visit < visits; visit += 1) {
      const daysAgo = Math.floor(random() * 60);
      const picks = productIds
        .filter(() => random() < 0.35)
        .slice(0, 3);
      const chosen = picks.length ? picks : [productIds[Math.floor(random() * productIds.length)]!];
      const amount = chosen.reduce((sum, id) => {
        const product = store.find<{ price_cents: number }>('products', id);
        return sum + (product?.price_cents ?? 500);
      }, 0);

      const result = awardPoints(store, {
        membershipId: membership.id,
        amountCents: amount,
        locationId: locationIds[Math.floor(random() * locationIds.length)]!,
        source: 'pos',
        note: '',
      });

      // Backdate so the dashboard charts show a realistic trend.
      const when = new Date(Date.now() - daysAgo * 86_400_000 - Math.floor(random() * 12) * 3_600_000).toISOString();
      db.prepare(`UPDATE transactions SET created_at = ? WHERE id = ?`).run(when, result.transaction.id);
    }

    const refreshed = store.findOrFail<{ points_balance: number }>('memberships', membership.id);
    // Give roughly every third member a redemption to fill the queue.
    if (memberIndex % 3 === 0) {
      const affordable = rewardIds
        .map((id) => store.find<{ id: string; points_cost: number }>('rewards', id)!)
        .filter((reward) => reward.points_cost <= refreshed.points_balance)
        .sort((a, b) => b.points_cost - a.points_cost);
      if (affordable[0]) {
        redeemReward(store, { membershipId: membership.id, rewardId: affordable[0].id });
      }
    }
  }

  // Recompute last_activity_at from the backdated ledger.
  db.prepare(
    `UPDATE memberships
     SET last_activity_at = (
       SELECT MAX(created_at) FROM transactions t WHERE t.membership_id = memberships.id
     )
     WHERE merchant_id = ?`,
  ).run(merchantId);

  const memberCount = store.count('memberships');
  console.log(
    `  ${spec.businessName}: ${memberCount} members, ${locationIds.length} locations, ` +
      `${productIds.length} products, ${rewardIds.length} rewards`,
  );
}

async function main(): Promise<void> {
  if (RESET && config.databasePath !== ':memory:' && fs.existsSync(config.databasePath)) {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${config.databasePath}${suffix}`;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    console.log('Database reset.');
  }
  setDb(openDatabase(config.databasePath));

  console.log('Seeding demo data...');
  const customers = await ensureCustomers();
  for (const chain of CHAINS) {
    await buildChain(chain, customers);
  }

  console.log('\nDone. Sign in with:');
  console.log('\n  Merchant CRM (http://localhost:5174)');
  for (const chain of CHAINS) {
    console.log(`    ${chain.businessName.padEnd(18)} ${chain.email.padEnd(30)} ${DEMO_PASSWORD}`);
    for (const member of chain.staff) {
      console.log(`      ${member.role.padEnd(16)} ${member.email.padEnd(30)} ${DEMO_PASSWORD}`);
    }
  }
  console.log('\n  Customer app (http://localhost:5173)');
  for (const person of CUSTOMERS.slice(0, 3)) {
    console.log(`    ${person.name.padEnd(18)} ${person.email.padEnd(30)} ${DEMO_PASSWORD}`);
  }
  console.log(
    '\nSign in as each merchant in turn: neither can see the other\'s members, even the ones they share.\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
