import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { auth, createCustomer, createLocation, createMerchant, freshApp, PASSWORD, type MerchantFixture } from './helpers';
import { getDb } from '../src/db';

let app: Express;

beforeEach(() => {
  app = freshApp();
});

/** Simulates time passing by moving the trial end date into the past. */
function expireTrial(merchantId: string): void {
  getDb()
    .prepare(`UPDATE merchants SET trial_ends_at = ? WHERE id = ?`)
    .run(new Date(Date.now() - 86_400_000).toISOString(), merchantId);
}

describe('plan limits', () => {
  it('stops a starter merchant adding a second location', async () => {
    const merchant = await createMerchant(app, { planCode: 'starter' });
    await createLocation(app, merchant, 'Shop 1');

    const response = await request(app)
      .post('/api/merchant/catalog/locations')
      .set(auth(merchant.ownerToken))
      .send({ name: 'Shop 2' })
      .expect(402);

    expect(response.body.error.code).toBe('subscription_required');
    expect(response.body.error.details.limit).toBe(1);
  });

  it('allows the same action after upgrading', async () => {
    const merchant = await createMerchant(app, { planCode: 'starter' });
    await createLocation(app, merchant, 'Shop 1');

    await request(app)
      .post('/api/merchant/account/billing/plan')
      .set(auth(merchant.ownerToken))
      .send({ planCode: 'growth' })
      .expect(200);

    await request(app)
      .post('/api/merchant/catalog/locations')
      .set(auth(merchant.ownerToken))
      .send({ name: 'Shop 2' })
      .expect(201);
  });

  it('caps staff accounts on the starter plan', async () => {
    const merchant = await createMerchant(app, { planCode: 'starter' });
    // The owner already counts as one of the three seats.
    for (const index of [1, 2]) {
      await request(app)
        .post('/api/merchant/team')
        .set(auth(merchant.ownerToken))
        .send({ name: `Staff ${index}`, email: `staff${index}-${Date.now()}@example.com`, password: PASSWORD, role: 'staff' })
        .expect(201);
    }
    await request(app)
      .post('/api/merchant/team')
      .set(auth(merchant.ownerToken))
      .send({ name: 'One too many', email: `extra-${Date.now()}@example.com`, password: PASSWORD, role: 'staff' })
      .expect(402);
  });

  it('refuses a downgrade that would strand existing data', async () => {
    const merchant = await createMerchant(app, { planCode: 'growth' });
    await createLocation(app, merchant, 'Shop 1');
    await createLocation(app, merchant, 'Shop 2');

    const response = await request(app)
      .post('/api/merchant/account/billing/plan')
      .set(auth(merchant.ownerToken))
      .send({ planCode: 'starter' })
      .expect(409);
    expect(response.body.error.message).toMatch(/remove some before downgrading/i);
  });
});

describe('when a subscription lapses', () => {
  let merchant: MerchantFixture;
  let membershipId: string;

  beforeEach(async () => {
    merchant = await createMerchant(app, { planCode: 'starter' });
    const customer = await createCustomer(app);
    const join = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/join`)
      .set(auth(customer.token))
      .expect(201);
    membershipId = join.body.membership.id;
    expireTrial(merchant.merchantId);
  });

  it('blocks billable writes with a clear reason', async () => {
    const response = await request(app)
      .post('/api/merchant/points/award')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 1000 })
      .expect(402);
    expect(response.body.error.message).toMatch(/free trial has ended/i);
  });

  it('still lets the merchant read and export their own data', async () => {
    await request(app).get('/api/merchant/dashboard').set(auth(merchant.ownerToken)).expect(200);
    await request(app).get('/api/merchant/members').set(auth(merchant.ownerToken)).expect(200);
    await request(app).get('/api/merchant/members/export/csv').set(auth(merchant.ownerToken)).expect(200);
  });

  it('resumes writes once a plan is chosen', async () => {
    await request(app)
      .post('/api/merchant/account/billing/plan')
      .set(auth(merchant.ownerToken))
      .send({ planCode: 'starter' })
      .expect(200);

    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 1000 })
      .expect(201);
  });

  it('blocks writes again after cancelling', async () => {
    await request(app)
      .post('/api/merchant/account/billing/plan')
      .set(auth(merchant.ownerToken))
      .send({ planCode: 'starter' })
      .expect(200);
    await request(app).post('/api/merchant/account/billing/cancel').set(auth(merchant.ownerToken)).expect(200);

    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 1000 })
      .expect(402);
  });
});

describe('suspended merchants', () => {
  it('cannot sign in or use an existing token', async () => {
    const merchant = await createMerchant(app);
    getDb().prepare(`UPDATE merchants SET status = 'suspended' WHERE id = ?`).run(merchant.merchantId);

    await request(app).get('/api/merchant/dashboard').set(auth(merchant.ownerToken)).expect(403);
    await request(app)
      .post('/api/auth/merchant/login')
      .send({ email: merchant.email, password: PASSWORD })
      .expect(401);
  });

  it('disappears from the public directory', async () => {
    const merchant = await createMerchant(app, { businessName: 'Vanishing Cafe' });
    const before = await request(app).get('/api/merchants').expect(200);
    expect(before.body.merchants.some((m: { id: string }) => m.id === merchant.merchantId)).toBe(true);

    getDb().prepare(`UPDATE merchants SET status = 'suspended' WHERE id = ?`).run(merchant.merchantId);

    const after = await request(app).get('/api/merchants').expect(200);
    expect(after.body.merchants.some((m: { id: string }) => m.id === merchant.merchantId)).toBe(false);
    await request(app).get(`/api/merchants/${merchant.slug}`).expect(404);
  });
});

describe('public pricing', () => {
  it('publishes the plan catalogue for the marketing site', async () => {
    const response = await request(app).get('/api/plans').expect(200);
    expect(response.body.plans.map((p: { code: string }) => p.code)).toEqual(['starter', 'growth', 'scale']);
    expect(response.body.plans[0].features.length).toBeGreaterThan(0);
  });
});
