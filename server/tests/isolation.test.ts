/**
 * The security requirement this product is sold on: a merchant sees their own
 * data and nothing else.
 *
 * Two merchants are set up with a deliberately shared customer, then Merchant B
 * is handed Merchant A's real record ids and a valid token, and tries to read,
 * change and delete every one of them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  addStaff, auth, createCustomer, createLocation, createMerchant, createProduct, createReward,
  freshApp, joinProgramme, type CustomerFixture, type MerchantFixture,
} from './helpers';

let app: Express;
let alpha: MerchantFixture;   // "Merchant A"
let beta: MerchantFixture;    // "Merchant B" — the attacker in these tests
let shared: CustomerFixture;  // a customer who shops at both

const alphaIds = {
  membershipId: '', locationId: '', productId: '', rewardId: '',
  tierId: '', campaignId: '', staffId: '', redemptionId: '', transactionId: '',
};

beforeAll(async () => {
  app = freshApp();
  alpha = await createMerchant(app, { businessName: 'Alpha Coffee' });
  beta = await createMerchant(app, { businessName: 'Beta Bakery' });
  shared = await createCustomer(app);

  // The same person joins both programmes.
  alphaIds.membershipId = await joinProgramme(app, shared, alpha);
  await joinProgramme(app, shared, beta);

  alphaIds.locationId = await createLocation(app, alpha, 'Alpha HQ');
  alphaIds.productId = await createProduct(app, alpha, 'Alpha Espresso', 400);
  alphaIds.rewardId = await createReward(app, alpha, 20, 'Alpha Free Coffee');
  alphaIds.staffId = (await addStaff(app, alpha, 'manager')).id;

  const tier = await request(app)
    .post('/api/merchant/catalog/tiers')
    .set(auth(alpha.ownerToken))
    .send({ name: 'Alpha VIP', minLifetimePoints: 10, multiplier: 2 })
    .expect(201);
  alphaIds.tierId = tier.body.item.id;

  const campaign = await request(app)
    .post('/api/merchant/catalog/campaigns')
    .set(auth(alpha.ownerToken))
    .send({ name: 'Alpha Weekend', type: 'multiplier', multiplier: 2 })
    .expect(201);
  alphaIds.campaignId = campaign.body.item.id;

  const award = await request(app)
    .post('/api/merchant/points/award')
    .set(auth(alpha.ownerToken))
    .send({ membershipId: alphaIds.membershipId, amountCents: 5000, locationId: alphaIds.locationId })
    .expect(201);
  alphaIds.transactionId = award.body.transaction.id;

  const redemption = await request(app)
    .post(`/api/customer/merchants/${alpha.merchantId}/redeem`)
    .set(auth(shared.token))
    .send({ rewardId: alphaIds.rewardId })
    .expect(201);
  alphaIds.redemptionId = redemption.body.redemption.id;
});

describe('reading another merchant’s records', () => {
  const resources = () => [
    { name: 'member', path: `/api/merchant/members/${alphaIds.membershipId}` },
    { name: 'location', path: `/api/merchant/catalog/locations/${alphaIds.locationId}` },
    { name: 'product', path: `/api/merchant/catalog/products/${alphaIds.productId}` },
    { name: 'reward', path: `/api/merchant/catalog/rewards/${alphaIds.rewardId}` },
    { name: 'tier', path: `/api/merchant/catalog/tiers/${alphaIds.tierId}` },
    { name: 'campaign', path: `/api/merchant/catalog/campaigns/${alphaIds.campaignId}` },
  ];

  it('returns 404 for every resource id belonging to another merchant', async () => {
    for (const resource of resources()) {
      const response = await request(app).get(resource.path).set(auth(beta.ownerToken));
      expect(response.status, `${resource.name} should not be readable by another merchant`).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Alpha');
    }
  });

  it('returns the resource to its own merchant, proving the ids are real', async () => {
    for (const resource of resources()) {
      await request(app).get(resource.path).set(auth(alpha.ownerToken)).expect(200);
    }
  });

  it('never lists another merchant’s members', async () => {
    const response = await request(app)
      .get('/api/merchant/members?limit=200')
      .set(auth(beta.ownerToken))
      .expect(200);
    const ids = response.body.members.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(alphaIds.membershipId);
  });

  it('does not leak members through search, even by exact email', async () => {
    const response = await request(app)
      .get(`/api/merchant/members?q=${encodeURIComponent(shared.email)}`)
      .set(auth(beta.ownerToken))
      .expect(200);
    // Beta legitimately has its own membership for this person, and only that one.
    for (const member of response.body.members) {
      expect(member.id).not.toBe(alphaIds.membershipId);
    }
  });

  it('keeps each merchant’s balance for a shared customer separate', async () => {
    const alphaView = await request(app)
      .get(`/api/merchant/members/${alphaIds.membershipId}`)
      .set(auth(alpha.ownerToken))
      .expect(200);

    const betaList = await request(app)
      .get(`/api/merchant/members?q=${encodeURIComponent(shared.email)}`)
      .set(auth(beta.ownerToken))
      .expect(200);

    // Alpha recorded a 5000c purchase for this person; Beta only ever gave them
    // its own welcome bonus, and must not inherit a point of Alpha's activity.
    // 50 welcome bonus, then $50 spent -> 50 base points, doubled by the VIP
    // tier and doubled again by the weekend campaign = 250 lifetime points.
    const WELCOME_BONUS = 50;
    expect(alphaView.body.member.lifetimePoints).toBe(WELCOME_BONUS + 50 * 2 * 2);
    expect(alphaView.body.member.totalSpendCents).toBe(5000);
    expect(betaList.body.members).toHaveLength(1);
    expect(betaList.body.members[0].lifetimePoints).toBe(WELCOME_BONUS);
    expect(betaList.body.members[0].totalSpendCents).toBe(0);
  });

  it('scopes the transaction ledger to the merchant that recorded it', async () => {
    const response = await request(app)
      .get('/api/merchant/points/transactions?limit=200')
      .set(auth(beta.ownerToken))
      .expect(200);
    const ids = response.body.transactions.map((t: { id: string }) => t.id);
    expect(ids).not.toContain(alphaIds.transactionId);
  });

  it('scopes the redemption queue', async () => {
    const response = await request(app)
      .get('/api/merchant/points/redemptions?status=all')
      .set(auth(beta.ownerToken))
      .expect(200);
    const ids = response.body.redemptions.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(alphaIds.redemptionId);
  });

  it('does not resolve another merchant’s redemption code', async () => {
    const own = await request(app)
      .get('/api/merchant/points/redemptions?status=all')
      .set(auth(alpha.ownerToken))
      .expect(200);
    const code = own.body.redemptions[0].code;
    await request(app)
      .get(`/api/merchant/points/redemptions/code/${code}`)
      .set(auth(beta.ownerToken))
      .expect(404);
    await request(app)
      .get(`/api/merchant/points/redemptions/code/${code}`)
      .set(auth(alpha.ownerToken))
      .expect(200);
  });

  it('scopes the audit log', async () => {
    const response = await request(app)
      .get('/api/merchant/account/audit?limit=200')
      .set(auth(beta.ownerToken))
      .expect(200);
    for (const entry of response.body.entries) {
      expect(entry.entityId).not.toBe(alphaIds.membershipId);
      expect(entry.entityId).not.toBe(alphaIds.locationId);
    }
  });

  it('scopes the team list', async () => {
    const response = await request(app)
      .get('/api/merchant/team')
      .set(auth(beta.ownerToken))
      .expect(200);
    const ids = response.body.team.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(alphaIds.staffId);
    expect(ids).not.toContain(alpha.ownerId);
  });

  it('reports dashboard figures for the caller’s merchant only', async () => {
    const alphaDash = await request(app).get('/api/merchant/dashboard').set(auth(alpha.ownerToken)).expect(200);
    const betaDash = await request(app).get('/api/merchant/dashboard').set(auth(beta.ownerToken)).expect(200);

    expect(alphaDash.body.period.revenueCents).toBe(5000);
    // Beta has taken no money and must not see Alpha's revenue in its own totals.
    expect(betaDash.body.period.revenueCents).toBe(0);
    expect(betaDash.body.members.lifetimePointsIssued).toBeLessThan(
      alphaDash.body.members.lifetimePointsIssued,
    );
  });

  it('excludes another merchant’s members from CSV export', async () => {
    const response = await request(app)
      .get('/api/merchant/members/export/csv')
      .set(auth(beta.ownerToken))
      .expect(200);
    expect(response.text).not.toContain(alphaIds.membershipId);
  });
});

describe('writing to another merchant’s records', () => {
  it('cannot award points to another merchant’s member', async () => {
    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(beta.ownerToken))
      .send({ membershipId: alphaIds.membershipId, amountCents: 10_000 })
      .expect(404);

    const check = await request(app)
      .get(`/api/merchant/members/${alphaIds.membershipId}`)
      .set(auth(alpha.ownerToken))
      .expect(200);
    expect(check.body.member.totalSpendCents).toBe(5000);
  });

  it('cannot adjust another merchant’s member balance', async () => {
    await request(app)
      .post('/api/merchant/points/adjust')
      .set(auth(beta.ownerToken))
      .send({ membershipId: alphaIds.membershipId, points: 9999, note: 'attempted theft' })
      .expect(404);
  });

  it('cannot edit or delete another merchant’s catalogue', async () => {
    const targets = [
      `/api/merchant/catalog/locations/${alphaIds.locationId}`,
      `/api/merchant/catalog/products/${alphaIds.productId}`,
      `/api/merchant/catalog/rewards/${alphaIds.rewardId}`,
      `/api/merchant/catalog/tiers/${alphaIds.tierId}`,
      `/api/merchant/catalog/campaigns/${alphaIds.campaignId}`,
    ];
    for (const target of targets) {
      await request(app).patch(target).set(auth(beta.ownerToken)).send({ name: 'Hijacked' }).expect(404);
      await request(app).delete(target).set(auth(beta.ownerToken)).expect(404);
    }
    // Everything survived untouched.
    const product = await request(app)
      .get(`/api/merchant/catalog/products/${alphaIds.productId}`)
      .set(auth(alpha.ownerToken))
      .expect(200);
    expect(product.body.item.name).toBe('Alpha Espresso');
  });

  it('cannot annotate another merchant’s member', async () => {
    await request(app)
      .patch(`/api/merchant/members/${alphaIds.membershipId}`)
      .set(auth(beta.ownerToken))
      .send({ notes: 'injected note', status: 'blocked' })
      .expect(404);
  });

  it('cannot fulfil or cancel another merchant’s redemption', async () => {
    await request(app)
      .post(`/api/merchant/points/redemptions/${alphaIds.redemptionId}/fulfil`)
      .set(auth(beta.ownerToken))
      .expect(404);
    await request(app)
      .post(`/api/merchant/points/redemptions/${alphaIds.redemptionId}/cancel`)
      .set(auth(beta.ownerToken))
      .send({ reason: 'nope' })
      .expect(404);
  });

  it('cannot modify or remove another merchant’s staff', async () => {
    await request(app)
      .patch(`/api/merchant/team/${alphaIds.staffId}`)
      .set(auth(beta.ownerToken))
      .send({ role: 'owner' })
      .expect(404);
    await request(app).delete(`/api/merchant/team/${alphaIds.staffId}`).set(auth(beta.ownerToken)).expect(404);
  });

  it('ignores a merchant_id smuggled into a create payload', async () => {
    const response = await request(app)
      .post('/api/merchant/catalog/products')
      .set(auth(beta.ownerToken))
      .send({ name: 'Smuggled', priceCents: 100, merchant_id: alpha.merchantId, merchantId: alpha.merchantId })
      .expect(201);

    // The row was created for Beta, not Alpha.
    await request(app)
      .get(`/api/merchant/catalog/products/${response.body.item.id}`)
      .set(auth(beta.ownerToken))
      .expect(200);
    await request(app)
      .get(`/api/merchant/catalog/products/${response.body.item.id}`)
      .set(auth(alpha.ownerToken))
      .expect(404);
  });

  it('cannot move an existing row to another merchant', async () => {
    const own = await createProduct(app, beta, 'Beta Bun', 300);
    await request(app)
      .patch(`/api/merchant/catalog/products/${own}`)
      .set(auth(beta.ownerToken))
      .send({ name: 'Beta Bun v2', merchant_id: alpha.merchantId })
      .expect(200);

    await request(app)
      .get(`/api/merchant/catalog/products/${own}`)
      .set(auth(alpha.ownerToken))
      .expect(404);
  });

  it('cannot change another merchant’s settings or billing', async () => {
    await request(app)
      .patch('/api/merchant/account/settings')
      .set(auth(beta.ownerToken))
      .send({ name: 'Hijacked Coffee' })
      .expect(200);

    const alphaSettings = await request(app)
      .get('/api/merchant/account/settings')
      .set(auth(alpha.ownerToken))
      .expect(200);
    expect(alphaSettings.body.merchant.name).toBe('Alpha Coffee');
  });
});

describe('token handling', () => {
  it('rejects a merchant token on the customer API and vice versa', async () => {
    await request(app).get('/api/customer/wallet').set(auth(alpha.ownerToken)).expect(401);
    await request(app).get('/api/merchant/dashboard').set(auth(shared.token)).expect(401);
  });

  it('rejects a token whose signature has been altered', async () => {
    const tampered = alpha.ownerToken.slice(0, -4) + 'AAAA';
    await request(app).get('/api/merchant/dashboard').set(auth(tampered)).expect(401);
  });

  it('rejects a token with a re-signed payload pointing at another merchant', async () => {
    // Re-encoding the payload without the server's secret must not be accepted.
    const [header, payload, signature] = beta.ownerToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    decoded.mid = alpha.merchantId;
    const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    await request(app)
      .get('/api/merchant/dashboard')
      .set(auth(`${header}.${forgedPayload}.${signature}`))
      .expect(401);
  });

  it('requires authentication at all', async () => {
    await request(app).get('/api/merchant/dashboard').expect(401);
    await request(app).get('/api/merchant/members').expect(401);
    await request(app).get('/api/customer/wallet').expect(401);
  });
});

describe('customer-side isolation', () => {
  it('will not show one customer another customer’s membership', async () => {
    const other = await createCustomer(app);
    await joinProgramme(app, other, alpha);

    const wallet = await request(app).get('/api/customer/wallet').set(auth(other.token)).expect(200);
    const ids = wallet.body.wallet.map((entry: { id: string }) => entry.id);
    expect(ids).not.toContain(alphaIds.membershipId);
  });

  it('will not let a customer redeem against a programme they have not joined', async () => {
    const outsider = await createCustomer(app);
    await request(app)
      .post(`/api/customer/merchants/${alpha.merchantId}/redeem`)
      .set(auth(outsider.token))
      .send({ rewardId: alphaIds.rewardId })
      .expect(404);
  });

  it('will not let a customer spend points from another merchant’s reward catalogue', async () => {
    const betaReward = await createReward(app, beta, 10, 'Beta Free Bun');
    await request(app)
      .post(`/api/customer/merchants/${alpha.merchantId}/redeem`)
      .set(auth(shared.token))
      .send({ rewardId: betaReward })
      .expect(404);
  });
});
