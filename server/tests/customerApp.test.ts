import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  auth, createCustomer, createMerchant, createProduct, createReward, freshApp, joinProgramme,
  type CustomerFixture, type MerchantFixture,
} from './helpers';

let app: Express;
let merchant: MerchantFixture;
let customer: CustomerFixture;

beforeEach(async () => {
  app = freshApp();
  merchant = await createMerchant(app, { businessName: 'Wallet Coffee' });
  customer = await createCustomer(app);
});

describe('discovering and joining programmes', () => {
  it('lists merchants with their public details only', async () => {
    const response = await request(app).get('/api/merchants').expect(200);
    const listed = response.body.merchants.find((m: { id: string }) => m.id === merchant.merchantId);
    expect(listed.name).toBe('Wallet Coffee');
    // No operational data belongs in a public listing.
    expect(listed.memberCount).toBeUndefined();
    expect(listed.revenue).toBeUndefined();
  });

  it('shows the storefront by slug', async () => {
    await createProduct(app, merchant, 'House Blend', 450);
    const response = await request(app).get(`/api/merchants/${merchant.slug}`).expect(200);
    expect(response.body.products.map((p: { name: string }) => p.name)).toContain('House Blend');
    expect(response.body.tiers.length).toBeGreaterThan(0);
  });

  it('awards the welcome bonus on joining', async () => {
    const response = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/join`)
      .set(auth(customer.token))
      .expect(201);
    expect(response.body.membership.pointsBalance).toBe(50);
  });

  it('is idempotent — joining twice does not double the bonus', async () => {
    await joinProgramme(app, customer, merchant);
    const again = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/join`)
      .set(auth(customer.token))
      .expect(201);
    expect(again.body.membership.pointsBalance).toBe(50);
  });
});

describe('the wallet', () => {
  it('shows every programme with its own balance', async () => {
    const second = await createMerchant(app, { businessName: 'Second Cafe' });
    await joinProgramme(app, customer, merchant);
    const membershipId = await joinProgramme(app, customer, second);

    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(second.ownerToken))
      .send({ membershipId, amountCents: 10_000 })
      .expect(201);

    const wallet = await request(app).get('/api/customer/wallet').set(auth(customer.token)).expect(200);
    expect(wallet.body.wallet).toHaveLength(2);
    const balances = Object.fromEntries(
      wallet.body.wallet.map((entry: any) => [entry.merchant.name, entry.pointsBalance]),
    );
    expect(balances['Wallet Coffee']).toBe(50);
    expect(balances['Second Cafe']).toBe(150);
    expect(wallet.body.totals.pointsAcrossProgrammes).toBe(200);
  });

  it('reports progress toward the next tier', async () => {
    const membershipId = await joinProgramme(app, customer, merchant);
    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 20_000 })
      .expect(201);

    const response = await request(app)
      .get(`/api/customer/merchants/${merchant.merchantId}/membership`)
      .set(auth(customer.token))
      .expect(200);

    expect(response.body.membership.tier.name).toBe('Member');
    expect(response.body.membership.nextTier.name).toBe('Silver');
    expect(response.body.membership.nextTier.pointsToGo).toBe(250);
  });

  it('lists activity with a running balance', async () => {
    const membershipId = await joinProgramme(app, customer, merchant);
    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 1000 })
      .expect(201);

    const response = await request(app)
      .get(`/api/customer/merchants/${merchant.merchantId}/activity`)
      .set(auth(customer.token))
      .expect(200);

    expect(response.body.activity[0].pointsDelta).toBe(10);
    expect(response.body.activity[0].balanceAfter).toBe(60);
    expect(response.body.activity[1].type).toBe('signup_bonus');
  });

  it('collects redemption codes from every programme in one place', async () => {
    await joinProgramme(app, customer, merchant);
    const rewardId = await createReward(app, merchant, 40, 'Free cortado');
    await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId })
      .expect(201);

    const response = await request(app).get('/api/customer/redemptions').set(auth(customer.token)).expect(200);
    expect(response.body.redemptions[0].reward.name).toBe('Free cortado');
    expect(response.body.redemptions[0].merchant.name).toBe('Wallet Coffee');
    expect(response.body.redemptions[0].status).toBe('pending');
  });
});

describe('customer profile', () => {
  it('updates name and contact details', async () => {
    const response = await request(app)
      .patch('/api/customer/profile')
      .set(auth(customer.token))
      .send({ name: 'Updated Name', phone: '+60123456789' })
      .expect(200);
    expect(response.body.customer.name).toBe('Updated Name');
  });

  it('refuses an email already used by someone else', async () => {
    const other = await createCustomer(app);
    await request(app)
      .patch('/api/customer/profile')
      .set(auth(customer.token))
      .send({ email: other.email })
      .expect(409);
  });
});

describe('input handling', () => {
  it('rejects an oversized or malformed payload', async () => {
    await joinProgramme(app, customer, merchant);
    await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId: 12345 })
      .expect(400);
  });

  it('treats SQL metacharacters in search as plain text', async () => {
    const injection = "'; DROP TABLE memberships; --";
    await request(app)
      .get(`/api/merchant/members?q=${encodeURIComponent(injection)}`)
      .set(auth(merchant.ownerToken))
      .expect(200);

    // The table is still there and still queryable.
    await request(app).get('/api/merchant/members').set(auth(merchant.ownerToken)).expect(200);
  });

  it('neutralises formula injection in the CSV export', async () => {
    const evil = await request(app)
      .post('/api/auth/customer/signup')
      .send({ name: '=cmd|calc!A1', email: `evil-${Date.now()}@example.com`, password: 'testpass123' })
      .expect(201);

    await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/join`)
      .set(auth(evil.body.accessToken))
      .expect(201);

    const csv = await request(app)
      .get('/api/merchant/members/export/csv')
      .set(auth(merchant.ownerToken))
      .expect(200);
    expect(csv.text).toContain("'=cmd|calc!A1");
    expect(csv.text).not.toMatch(/^=cmd/m);
  });
});
