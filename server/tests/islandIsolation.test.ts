/**
 * The island under the same rule as the rest of the product: a merchant sees
 * their own data and nothing else.
 *
 * A mission is the most sensitive thing this platform stores. It is a merchant
 * asking, in their own words, what they are thinking of building, and getting
 * back a costed strategy for it. Alpha runs a real mission; Beta is then handed
 * every one of its real ids along with a perfectly valid token, and tries to
 * read it, steer it and delete it.
 */
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { setProvider } from '../src/island/provider';
import { auth, createCustomer, createMerchant, freshApp, type MerchantFixture } from './helpers';

let app: Express;
let alpha: MerchantFixture;
let beta: MerchantFixture;
let customerToken: string;

const alphaIds = { missionId: '', runId: '', reference: '' };
const SECRET_TASK = 'Should Alpha Coffee buy out the roastery on Chaandhanee Magu before Beta hears about it?';

beforeAll(async () => {
  setProvider(null);
  app = freshApp();
  alpha = await createMerchant(app, { businessName: 'Alpha Coffee' });
  beta = await createMerchant(app, { businessName: 'Beta Bakery' });
  customerToken = (await createCustomer(app)).token;

  const created = await request(app)
    .post('/api/island/missions')
    .set(auth(alpha.ownerToken))
    .send({ task: SECRET_TASK, geography: 'Maldives' })
    .expect(201);
  alphaIds.missionId = created.body.mission.id;
  alphaIds.reference = created.body.mission.reference;

  // Let it finish so there is a report, sources and an audit trail to steal.
  const deadline = Date.now() + 25_000;
  for (;;) {
    const detail = await request(app)
      .get(`/api/island/missions/${alphaIds.missionId}`)
      .set(auth(alpha.ownerToken))
      .expect(200);
    if (detail.body.mission.status === 'completed') {
      alphaIds.runId = detail.body.runs[0].id;
      break;
    }
    if (Date.now() > deadline) throw new Error(`Alpha's mission stalled in ${detail.body.mission.status}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}, 40_000);

describe('Beta cannot read Alpha’s mission', () => {
  const reads: [string, string][] = [
    ['the mission itself', ''],
    ['the report', '/report'],
    ['the live stream', '/stream'],
  ];

  it.each(reads)('refuses %s', async (_label, suffix) => {
    const response = await request(app)
      .get(`/api/island/missions/${alphaIds.missionId}${suffix}`)
      .set(auth(beta.ownerToken));
    // 404 rather than 403: a 403 would confirm the id is real, which is itself
    // a fact about Alpha that Beta is not entitled to.
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('Chaandhanee');
  });

  it('refuses one agent run and the envelope inside it', async () => {
    await request(app)
      .get(`/api/island/missions/${alphaIds.missionId}/runs/${alphaIds.runId}`)
      .set(auth(beta.ownerToken))
      .expect(404);
  });

  it('will not pair Alpha’s run id with a mission of Beta’s own', async () => {
    const mine = await request(app)
      .post('/api/island/missions')
      .set(auth(beta.ownerToken))
      .send({ task: 'Work out whether Beta Bakery should open on Sundays.', start: false })
      .expect(201);

    await request(app)
      .get(`/api/island/missions/${mine.body.mission.id}/runs/${alphaIds.runId}`)
      .set(auth(beta.ownerToken))
      .expect(404);
  });

  it('does not list it among Beta’s own missions', async () => {
    const response = await request(app)
      .get('/api/island/missions')
      .set(auth(beta.ownerToken))
      .expect(200);
    const ids = (response.body.missions as { id: string }[]).map((mission) => mission.id);
    expect(ids).not.toContain(alphaIds.missionId);
    expect(JSON.stringify(response.body)).not.toContain('Chaandhanee');
    // Mission numbers restart at 001 for every merchant by design, so Beta
    // holding a "MISSION-2026-001" of its own proves nothing either way — the
    // id and the task text are what would actually leak.
  });
});

describe('Beta cannot touch Alpha’s mission', () => {
  const writes: [string, string][] = [
    ['pause', '/pause'],
    ['resume', '/resume'],
    ['abort', '/abort'],
    ['approve', '/approve'],
  ];

  it.each(writes)('refuses to %s it', async (_label, suffix) => {
    await request(app)
      .post(`/api/island/missions/${alphaIds.missionId}${suffix}`)
      .set(auth(beta.ownerToken))
      .send({})
      .expect(404);
  });

  it('refuses to ask it a follow-up question', async () => {
    await request(app)
      .post(`/api/island/missions/${alphaIds.missionId}/followups`)
      .set(auth(beta.ownerToken))
      .send({ question: 'What did Alpha decide about the roastery?' })
      .expect(404);
  });

  it('refuses to delete it', async () => {
    await request(app)
      .delete(`/api/island/missions/${alphaIds.missionId}`)
      .set(auth(beta.ownerToken))
      .expect(404);

    // And it is still there afterwards.
    await request(app)
      .get(`/api/island/missions/${alphaIds.missionId}`)
      .set(auth(alpha.ownerToken))
      .expect(200);
  });
});

describe('nobody outside the merchant CRM gets in at all', () => {
  it('turns away an unauthenticated caller', async () => {
    await request(app).get('/api/island/agents').expect(401);
    await request(app).get(`/api/island/missions/${alphaIds.missionId}`).expect(401);
  });

  it('turns away a customer-app token', async () => {
    await request(app)
      .get(`/api/island/missions/${alphaIds.missionId}`)
      .set(auth(customerToken))
      .expect(401);
  });

  it('turns away a point-of-sale API key', async () => {
    const key = await request(app)
      .post('/api/merchant/api-keys')
      .set(auth(alpha.ownerToken))
      .send({ name: 'Till 1' })
      .expect(201);

    // A key that can award points must not be able to spend the merchant's
    // model budget or read their strategy.
    const response = await request(app)
      .post('/api/island/missions')
      .set(auth(key.body.key.secret ?? key.body.secret ?? ''))
      .send({ task: 'Find out what Alpha Coffee should build next.' });
    expect([401, 403]).toContain(response.status);
  });
});

describe('the roster is per merchant', () => {
  it('does not leak one merchant’s choice of agents to another', async () => {
    await request(app)
      .patch('/api/island/agents/legal')
      .set(auth(alpha.ownerToken))
      .send({ enabled: true })
      .expect(200);

    const betaRoster = await request(app)
      .get('/api/island/agents')
      .set(auth(beta.ownerToken))
      .expect(200);

    const legal = (
      betaRoster.body.agents as { definition: { id: string }; enabled: boolean }[]
    ).find((entry) => entry.definition.id === 'legal');
    expect(legal?.enabled).toBe(false);
  });

  it('counts each merchant’s daily mission budget separately', async () => {
    const before = (
      await request(app).get('/api/island/agents').set(auth(beta.ownerToken)).expect(200)
    ).body.missionsToday as number;

    await request(app)
      .post('/api/island/missions')
      .set(auth(alpha.ownerToken))
      .send({ task: 'Price a second Alpha Coffee site near the ferry terminal.', start: false })
      .expect(201);

    const after = (
      await request(app).get('/api/island/agents').set(auth(beta.ownerToken)).expect(200)
    ).body.missionsToday as number;
    // Alpha spending its own budget must not spend Beta's.
    expect(after).toBe(before);

    const alphaToday = (
      await request(app).get('/api/island/agents').set(auth(alpha.ownerToken)).expect(200)
    ).body.missionsToday as number;
    expect(alphaToday).toBeGreaterThan(before);
  });
});

describe('the island writes to the audit log like everything else', () => {
  it('records who started a mission, in that merchant’s own log', async () => {
    const log = await request(app)
      .get('/api/merchant/account/audit')
      .set(auth(alpha.ownerToken))
      .expect(200);

    const actions = (log.body.entries as { action: string }[]).map((entry) => entry.action);
    expect(actions).toContain('island.mission_created');

    const betaLog = await request(app)
      .get('/api/merchant/account/audit')
      .set(auth(beta.ownerToken))
      .expect(200);
    expect(JSON.stringify(betaLog.body)).not.toContain(alphaIds.missionId);
  });
});
