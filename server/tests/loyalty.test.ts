import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  auth, createCustomer, createLocation, createMerchant, createReward, freshApp, joinProgramme,
  type CustomerFixture, type MerchantFixture,
} from './helpers';
import { calculatePoints } from '../src/services/loyalty';

let app: Express;
let merchant: MerchantFixture;
let customer: CustomerFixture;
let membershipId: string;

const settings = {
  points_per_currency: 1,
  signup_bonus_points: 0,
  points_expiry_days: null,
  redeem_needs_staff: 1,
};

beforeEach(async () => {
  app = freshApp();
  merchant = await createMerchant(app);
  customer = await createCustomer(app);
  membershipId = await joinProgramme(app, customer, merchant);
});

describe('points calculation', () => {
  it('awards one point per currency unit by default', () => {
    const result = calculatePoints({ amountCents: 1250, settings, tier: null, campaigns: [] });
    expect(result.total).toBe(12);
  });

  it('applies the tier multiplier', () => {
    const tier = { id: 't', name: 'Gold', min_lifetime_points: 0, multiplier: 1.5, color: '#000', perks: '[]', sort_order: 0 };
    expect(calculatePoints({ amountCents: 10_000, settings, tier, campaigns: [] }).total).toBe(150);
  });

  it('stacks campaign multipliers on top of the tier multiplier', () => {
    const tier = { id: 't', name: 'Gold', min_lifetime_points: 0, multiplier: 2, color: '#000', perks: '[]', sort_order: 0 };
    const campaigns = [
      { id: 'c', name: 'Double Tuesday', type: 'multiplier' as const, multiplier: 2, bonus_points: 0, min_spend_cents: 0, location_id: null },
    ];
    expect(calculatePoints({ amountCents: 5000, settings, tier, campaigns }).total).toBe(200);
  });

  it('adds flat campaign bonuses after multiplication', () => {
    const campaigns = [
      { id: 'c', name: 'Welcome back', type: 'bonus' as const, multiplier: 1, bonus_points: 25, min_spend_cents: 0, location_id: null },
    ];
    expect(calculatePoints({ amountCents: 1000, settings, tier: null, campaigns }).total).toBe(35);
  });

  it('ignores campaigns whose minimum spend is not met', () => {
    const campaigns = [
      { id: 'c', name: 'Big spender', type: 'bonus' as const, multiplier: 1, bonus_points: 100, min_spend_cents: 5000, location_id: null },
    ];
    expect(calculatePoints({ amountCents: 1000, settings, tier: null, campaigns }).total).toBe(10);
  });

  it('never returns fractional or negative points', () => {
    const result = calculatePoints({ amountCents: 199, settings, tier: null, campaigns: [] });
    expect(Number.isInteger(result.total)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });
});

describe('awarding points', () => {
  it('records a ledger entry and moves the balance', async () => {
    const response = await request(app)
      .post('/api/merchant/points/award')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 3000 })
      .expect(201);

    expect(response.body.transaction.pointsDelta).toBe(30);
    expect(response.body.member.pointsBalance).toBe(80); // 50 welcome bonus + 30
    expect(response.body.transaction.balanceAfter).toBe(80);
  });

  it('is idempotent for a repeated POS reference', async () => {
    const payload = { membershipId, amountCents: 4000, reference: 'order-1234' };
    const first = await request(app).post('/api/merchant/points/award').set(auth(merchant.ownerToken)).send(payload).expect(201);
    const retry = await request(app).post('/api/merchant/points/award').set(auth(merchant.ownerToken)).send(payload).expect(201);

    expect(retry.body.transaction.id).toBe(first.body.transaction.id);

    const member = await request(app)
      .get(`/api/merchant/members/${membershipId}`)
      .set(auth(merchant.ownerToken))
      .expect(200);
    expect(member.body.member.pointsBalance).toBe(90); // charged once, not twice
  });

  it('promotes a member when they cross a tier threshold', async () => {
    const response = await request(app)
      .post('/api/merchant/points/award')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 60_000 })
      .expect(201);
    expect(response.body.tierUpgradedTo?.name).toBe('Silver');
  });

  it('rejects a location that belongs to another merchant', async () => {
    const other = await createMerchant(app);
    const foreignLocation = await createLocation(app, other, 'Their store');
    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 1000, locationId: foreignLocation })
      .expect(404);
  });

  it('previews the award without changing anything', async () => {
    const preview = await request(app)
      .post('/api/merchant/points/preview')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 2500 })
      .expect(200);
    expect(preview.body.breakdown.total).toBe(25);

    const member = await request(app)
      .get(`/api/merchant/members/${membershipId}`)
      .set(auth(merchant.ownerToken))
      .expect(200);
    expect(member.body.member.pointsBalance).toBe(50);
  });

  it('refuses to award points to a blocked member', async () => {
    await request(app)
      .patch(`/api/merchant/members/${membershipId}`)
      .set(auth(merchant.ownerToken))
      .send({ status: 'blocked' })
      .expect(200);

    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, amountCents: 1000 })
      .expect(409);
  });
});

describe('manual adjustments', () => {
  it('requires a reason', async () => {
    await request(app)
      .post('/api/merchant/points/adjust')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, points: 100 })
      .expect(400);
  });

  it('will not push a balance below zero', async () => {
    await request(app)
      .post('/api/merchant/points/adjust')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, points: -5000, note: 'clawback' })
      .expect(400);
  });

  it('leaves an audit entry naming the staff member', async () => {
    await request(app)
      .post('/api/merchant/points/adjust')
      .set(auth(merchant.ownerToken))
      .send({ membershipId, points: 40, note: 'goodwill for a spilled drink' })
      .expect(201);

    const audit = await request(app)
      .get('/api/merchant/account/audit?action=points.adjusted')
      .set(auth(merchant.ownerToken))
      .expect(200);
    expect(audit.body.entries[0].meta.note).toBe('goodwill for a spilled drink');
    expect(audit.body.entries[0].actorId).toBe(merchant.ownerId);
  });
});

describe('redeeming rewards', () => {
  it('spends points and issues a code', async () => {
    const rewardId = await createReward(app, merchant, 40, 'Free flat white');
    const response = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId })
      .expect(201);

    expect(response.body.membership.pointsBalance).toBe(10);
    expect(response.body.redemption.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('refuses when the balance is too low', async () => {
    const rewardId = await createReward(app, merchant, 5000, 'Espresso machine');
    const response = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId })
      .expect(409);
    expect(response.body.error.message).toMatch(/not enough points/i);
  });

  it('honours a per-member limit', async () => {
    const created = await request(app)
      .post('/api/merchant/catalog/rewards')
      .set(auth(merchant.ownerToken))
      .send({ name: 'One per customer', pointsCost: 10, perMemberLimit: 1 })
      .expect(201);

    await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId: created.body.item.id })
      .expect(201);

    await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId: created.body.item.id })
      .expect(409);
  });

  it('decrements limited stock and then sells out', async () => {
    const created = await request(app)
      .post('/api/merchant/catalog/rewards')
      .set(auth(merchant.ownerToken))
      .send({ name: 'Last one', pointsCost: 10, stock: 1 })
      .expect(201);

    await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId: created.body.item.id })
      .expect(201);

    const second = await createCustomer(app);
    await joinProgramme(app, second, merchant);
    const response = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(second.token))
      .send({ rewardId: created.body.item.id })
      .expect(409);
    expect(response.body.error.message).toMatch(/out of stock/i);
  });

  it('lets staff fulfil the code once and only once', async () => {
    const rewardId = await createReward(app, merchant, 40);
    const redemption = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId })
      .expect(201);

    await request(app)
      .post(`/api/merchant/points/redemptions/${redemption.body.redemption.id}/fulfil`)
      .set(auth(merchant.ownerToken))
      .expect(200);

    await request(app)
      .post(`/api/merchant/points/redemptions/${redemption.body.redemption.id}/fulfil`)
      .set(auth(merchant.ownerToken))
      .expect(409);
  });

  it('returns the points when a redemption is cancelled', async () => {
    const rewardId = await createReward(app, merchant, 40);
    const redemption = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId })
      .expect(201);

    await request(app)
      .post(`/api/merchant/points/redemptions/${redemption.body.redemption.id}/cancel`)
      .set(auth(merchant.ownerToken))
      .send({ reward: 'wrong item' })
      .expect(204);

    const member = await request(app)
      .get(`/api/merchant/members/${membershipId}`)
      .set(auth(merchant.ownerToken))
      .expect(200);
    expect(member.body.member.pointsBalance).toBe(50);
  });

  it('will not delete a reward that has already been redeemed', async () => {
    const rewardId = await createReward(app, merchant, 40);
    await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/redeem`)
      .set(auth(customer.token))
      .send({ rewardId })
      .expect(201);

    await request(app)
      .delete(`/api/merchant/catalog/rewards/${rewardId}`)
      .set(auth(merchant.ownerToken))
      .expect(409);
  });
});

describe('counter lookup', () => {
  it('finds a member by their number and by email', async () => {
    const member = await request(app)
      .get(`/api/merchant/members/${membershipId}`)
      .set(auth(merchant.ownerToken))
      .expect(200);

    const byNumber = await request(app)
      .post('/api/merchant/points/lookup')
      .set(auth(merchant.ownerToken))
      .send({ memberNumber: member.body.member.memberNumber })
      .expect(200);
    expect(byNumber.body.member.id).toBe(membershipId);

    const byEmail = await request(app)
      .post('/api/merchant/points/lookup')
      .set(auth(merchant.ownerToken))
      .send({ email: customer.email })
      .expect(200);
    expect(byEmail.body.member.id).toBe(membershipId);
  });

  it('accepts a fresh wallet QR token', async () => {
    const qr = await request(app)
      .get(`/api/customer/merchants/${merchant.merchantId}/qr`)
      .set(auth(customer.token))
      .expect(200);

    const lookup = await request(app)
      .post('/api/merchant/points/lookup')
      .set(auth(merchant.ownerToken))
      .send({ qrToken: qr.body.token })
      .expect(200);
    expect(lookup.body.member.id).toBe(membershipId);
  });

  it('refuses a QR token minted for a different merchant', async () => {
    const other = await createMerchant(app);
    await joinProgramme(app, customer, other);
    const qr = await request(app)
      .get(`/api/customer/merchants/${other.merchantId}/qr`)
      .set(auth(customer.token))
      .expect(200);

    await request(app)
      .post('/api/merchant/points/lookup')
      .set(auth(merchant.ownerToken))
      .send({ qrToken: qr.body.token })
      .expect(404);
  });

  it('rejects a forged QR token', async () => {
    await request(app)
      .post('/api/merchant/points/lookup')
      .set(auth(merchant.ownerToken))
      .send({ qrToken: 'not.a.real.token' })
      .expect(401);
  });
});
