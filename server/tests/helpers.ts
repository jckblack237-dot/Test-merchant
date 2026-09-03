import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { openDatabase, setDb } from '../src/db';
import { assertTenantTablesAreScoped } from '../src/db/tenant';

export interface MerchantFixture {
  merchantId: string;
  ownerToken: string;
  ownerId: string;
  slug: string;
  email: string;
}

export interface CustomerFixture {
  customerId: string;
  token: string;
  email: string;
}

/** Fresh in-memory database + app for each test file. */
export function freshApp(): Express {
  const db = openDatabase(':memory:');
  setDb(db);
  assertTenantTablesAreScoped(db);
  return createApp();
}

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export const PASSWORD = 'testpass123';

export async function createMerchant(
  app: Express,
  overrides: Partial<{ businessName: string; planCode: 'starter' | 'growth' | 'scale' }> = {},
): Promise<MerchantFixture> {
  const email = `${unique('owner')}@example.com`;
  const response = await request(app)
    .post('/api/auth/merchant/signup')
    .send({
      businessName: overrides.businessName ?? unique('Test Cafe '),
      ownerName: 'Test Owner',
      email,
      password: PASSWORD,
      planCode: overrides.planCode ?? 'growth',
    })
    .expect(201);

  return {
    merchantId: response.body.merchant.id,
    ownerToken: response.body.accessToken,
    ownerId: response.body.user.id,
    slug: response.body.merchant.slug,
    email,
  };
}

export async function createCustomer(app: Express): Promise<CustomerFixture> {
  const email = `${unique('customer')}@example.com`;
  const response = await request(app)
    .post('/api/auth/customer/signup')
    .send({ name: 'Test Customer', email, password: PASSWORD })
    .expect(201);
  return { customerId: response.body.customer.id, token: response.body.accessToken, email };
}

/** Adds a staff member to a merchant and returns their access token. */
export async function addStaff(
  app: Express,
  merchant: MerchantFixture,
  role: 'manager' | 'staff',
): Promise<{ id: string; token: string; email: string }> {
  const email = `${unique(role)}@example.com`;
  const created = await request(app)
    .post('/api/merchant/team')
    .set('authorization', `Bearer ${merchant.ownerToken}`)
    .send({ name: `Test ${role}`, email, password: PASSWORD, role })
    .expect(201);

  const login = await request(app)
    .post('/api/auth/merchant/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  return { id: created.body.user.id, token: login.body.accessToken, email };
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` } as const;
}

/** Enrols a customer into a merchant's programme and returns the membership id. */
export async function joinProgramme(
  app: Express,
  customer: CustomerFixture,
  merchant: MerchantFixture,
): Promise<string> {
  const response = await request(app)
    .post(`/api/customer/merchants/${merchant.merchantId}/join`)
    .set(auth(customer.token))
    .expect(201);
  return response.body.membership.id;
}

export async function createLocation(app: Express, merchant: MerchantFixture, name = 'Main Store') {
  const response = await request(app)
    .post('/api/merchant/catalog/locations')
    .set(auth(merchant.ownerToken))
    .send({ name, city: 'Testville' })
    .expect(201);
  return response.body.item.id as string;
}

export async function createProduct(app: Express, merchant: MerchantFixture, name = 'Latte', priceCents = 500) {
  const response = await request(app)
    .post('/api/merchant/catalog/products')
    .set(auth(merchant.ownerToken))
    .send({ name, priceCents })
    .expect(201);
  return response.body.item.id as string;
}

export async function createReward(app: Express, merchant: MerchantFixture, pointsCost = 50, name = 'Free coffee') {
  const response = await request(app)
    .post('/api/merchant/catalog/rewards')
    .set(auth(merchant.ownerToken))
    .send({ name, pointsCost })
    .expect(201);
  return response.body.item.id as string;
}
