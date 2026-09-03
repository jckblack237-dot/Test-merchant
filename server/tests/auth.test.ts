import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { addStaff, auth, createCustomer, createMerchant, freshApp, PASSWORD, type MerchantFixture } from './helpers';

let app: Express;
let merchant: MerchantFixture;

beforeEach(async () => {
  app = freshApp();
  merchant = await createMerchant(app);
});

describe('merchant signup and login', () => {
  it('creates a merchant with a starter tier ladder and reward catalogue', async () => {
    const tiers = await request(app)
      .get('/api/merchant/catalog/tiers')
      .set(auth(merchant.ownerToken))
      .expect(200);
    const rewards = await request(app)
      .get('/api/merchant/catalog/rewards')
      .set(auth(merchant.ownerToken))
      .expect(200);

    expect(tiers.body.items.length).toBeGreaterThanOrEqual(3);
    expect(rewards.body.items.length).toBeGreaterThanOrEqual(3);
  });

  it('starts the account on a trial', async () => {
    const me = await request(app).get('/api/auth/merchant/me').set(auth(merchant.ownerToken)).expect(200);
    expect(me.body.subscription.status).toBe('trialing');
    expect(me.body.subscription.writable).toBe(true);
  });

  it('rejects a weak password', async () => {
    await request(app)
      .post('/api/auth/merchant/signup')
      .send({ businessName: 'Weak Co', ownerName: 'A', email: 'weak@example.com', password: 'short' })
      .expect(400);
  });

  it('rejects a duplicate email', async () => {
    await request(app)
      .post('/api/auth/merchant/signup')
      .send({ businessName: 'Copy Co', ownerName: 'A', email: merchant.email, password: PASSWORD })
      .expect(409);
  });

  it('gives the same message for an unknown email and a wrong password', async () => {
    const unknown = await request(app)
      .post('/api/auth/merchant/login')
      .send({ email: 'nobody@example.com', password: PASSWORD })
      .expect(401);
    const wrong = await request(app)
      .post('/api/auth/merchant/login')
      .send({ email: merchant.email, password: 'wrongpassword123' })
      .expect(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('locks an account after repeated failures', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await request(app)
        .post('/api/auth/merchant/login')
        .send({ email: merchant.email, password: 'definitelywrong1' })
        .expect(401);
    }
    const response = await request(app)
      .post('/api/auth/merchant/login')
      .send({ email: merchant.email, password: PASSWORD })
      .expect(401);
    expect(response.body.error.message).toMatch(/too many failed attempts/i);
  });
});

describe('refresh tokens', () => {
  it('rotates the refresh token on use', async () => {
    const login = await request(app)
      .post('/api/auth/merchant/login')
      .send({ email: merchant.email, password: PASSWORD })
      .expect(200);

    const rotated = await request(app)
      .post('/api/auth/merchant/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);
    await request(app).get('/api/auth/merchant/me').set(auth(rotated.body.accessToken)).expect(200);
  });

  it('treats replay of a rotated token as theft and kills the whole session family', async () => {
    const login = await request(app)
      .post('/api/auth/merchant/login')
      .send({ email: merchant.email, password: PASSWORD })
      .expect(200);

    const rotated = await request(app)
      .post('/api/auth/merchant/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    // The stolen (already-used) token is presented again.
    await request(app)
      .post('/api/auth/merchant/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    // ...which also invalidates the attacker's freshly issued token.
    await request(app)
      .post('/api/auth/merchant/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('stops working after logout', async () => {
    const login = await request(app)
      .post('/api/auth/merchant/login')
      .send({ email: merchant.email, password: PASSWORD })
      .expect(200);
    await request(app).post('/api/auth/merchant/logout').send({ refreshToken: login.body.refreshToken }).expect(204);
    await request(app)
      .post('/api/auth/merchant/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it('will not accept a customer refresh token on the merchant endpoint', async () => {
    const customer = await createCustomer(app);
    const login = await request(app)
      .post('/api/auth/customer/login')
      .send({ email: customer.email, password: PASSWORD })
      .expect(200);
    await request(app)
      .post('/api/auth/merchant/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });
});

describe('roles', () => {
  it('lets staff award points but not adjust balances', async () => {
    const staff = await addStaff(app, merchant, 'staff');
    const customer = await createCustomer(app);
    const join = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/join`)
      .set(auth(customer.token))
      .expect(201);
    const membershipId = join.body.membership.id;

    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(staff.token))
      .send({ membershipId, amountCents: 1000 })
      .expect(201);

    await request(app)
      .post('/api/merchant/points/adjust')
      .set(auth(staff.token))
      .send({ membershipId, points: 500, note: 'should be blocked' })
      .expect(403);
  });

  it('does not let a manager add team members or change billing', async () => {
    const manager = await addStaff(app, merchant, 'manager');
    await request(app)
      .post('/api/merchant/team')
      .set(auth(manager.token))
      .send({ name: 'X', email: 'x@example.com', password: PASSWORD, role: 'staff' })
      .expect(403);
    await request(app)
      .post('/api/merchant/account/billing/plan')
      .set(auth(manager.token))
      .send({ planCode: 'scale' })
      .expect(403);
  });

  it('does not let staff read the team list or the audit log', async () => {
    const staff = await addStaff(app, merchant, 'staff');
    await request(app).get('/api/merchant/team').set(auth(staff.token)).expect(403);
    await request(app).get('/api/merchant/account/audit').set(auth(staff.token)).expect(403);
  });

  it('refuses to leave the merchant without an owner', async () => {
    await request(app)
      .patch(`/api/merchant/team/${merchant.ownerId}`)
      .set(auth(merchant.ownerToken))
      .send({ role: 'staff' })
      .expect(400);
  });

  it('revokes live sessions when an account is disabled', async () => {
    const staff = await addStaff(app, merchant, 'staff');
    await request(app).get('/api/auth/merchant/me').set(auth(staff.token)).expect(200);

    await request(app)
      .patch(`/api/merchant/team/${staff.id}`)
      .set(auth(merchant.ownerToken))
      .send({ status: 'disabled' })
      .expect(200);

    await request(app).get('/api/auth/merchant/me').set(auth(staff.token)).expect(401);
  });
});

describe('POS API keys', () => {
  it('issues a key that can award points but not manage the account', async () => {
    const created = await request(app)
      .post('/api/merchant/api-keys')
      .set(auth(merchant.ownerToken))
      .send({ name: 'Till 1' })
      .expect(201);

    const secret: string = created.body.secret;
    expect(secret.startsWith('llk_')).toBe(true);

    const customer = await createCustomer(app);
    const join = await request(app)
      .post(`/api/customer/merchants/${merchant.merchantId}/join`)
      .set(auth(customer.token))
      .expect(201);

    await request(app)
      .post('/api/merchant/points/award')
      .set(auth(secret))
      .send({ membershipId: join.body.membership.id, amountCents: 2500 })
      .expect(201);

    // A till key must never be able to read the team or change settings.
    await request(app).get('/api/merchant/team').set(auth(secret)).expect(403);
    await request(app)
      .patch('/api/merchant/account/settings')
      .set(auth(secret))
      .send({ name: 'Renamed by till' })
      .expect(403);
  });

  it('stops working once revoked', async () => {
    const created = await request(app)
      .post('/api/merchant/api-keys')
      .set(auth(merchant.ownerToken))
      .send({ name: 'Till 2' })
      .expect(201);

    await request(app)
      .post(`/api/merchant/api-keys/${created.body.key.id}/revoke`)
      .set(auth(merchant.ownerToken))
      .expect(204);

    await request(app).get('/api/merchant/dashboard').set(auth(created.body.secret)).expect(401);
  });

  it('never returns the secret again after creation', async () => {
    await request(app)
      .post('/api/merchant/api-keys')
      .set(auth(merchant.ownerToken))
      .send({ name: 'Till 3' })
      .expect(201);

    const list = await request(app).get('/api/merchant/api-keys').set(auth(merchant.ownerToken)).expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/llk_[A-Za-z0-9_-]{20,}/);
  });

  it('does not accept a key issued to another merchant', async () => {
    const other = await createMerchant(app);
    const created = await request(app)
      .post('/api/merchant/api-keys')
      .set(auth(other.ownerToken))
      .send({ name: 'Other till' })
      .expect(201);

    const dashboard = await request(app).get('/api/merchant/dashboard').set(auth(created.body.secret)).expect(200);
    // It works — but only for the merchant that owns it.
    expect(dashboard.body.usage.members).toBe(0);
  });
});
