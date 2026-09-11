import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setProvider } from '../src/island/provider';
import { addStaff, auth, createMerchant, freshApp, type MerchantFixture } from './helpers';

/**
 * An end-to-end mission on the simulation engine.
 *
 * The point of running the whole pipeline here is that the parts which are
 * easiest to fake are the ones that matter most: that agents really do run in
 * dependency order, that a failed verification really does send work back, and
 * that an unresolved problem really does reach the report instead of being
 * quietly dropped on the way. None of that is observable from a unit test of
 * any single module.
 */
let app: Express;
let merchant: MerchantFixture;

beforeEach(async () => {
  // No ANTHROPIC_API_KEY in the test environment, so the island runs on the
  // simulation provider — the same orchestrator, no model calls.
  setProvider(null);
  app = freshApp();
  merchant = await createMerchant(app);
});

afterEach(() => setProvider(null));

async function startMission(body: Record<string, unknown> = {}) {
  const response = await request(app)
    .post('/api/island/missions')
    .set(auth(merchant.ownerToken))
    .send({
      task: 'Find a business opportunity that is missing in the Maldives and say whether it is worth building.',
      geography: 'Maldives',
      currency: 'MVR',
      ...body,
    })
    .expect(201);
  return response.body.mission as { id: string; reference: string; status: string; engine: string };
}

async function waitForStatus(missionId: string, wanted: string[], timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await request(app)
      .get(`/api/island/missions/${missionId}`)
      .set(auth(merchant.ownerToken))
      .expect(200);
    if (wanted.includes(response.body.mission.status)) return response.body;
    if (Date.now() > deadline) {
      throw new Error(
        `Mission stalled in "${response.body.mission.status}" waiting for ${wanted.join('/')}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('a mission from start to report', () => {
  it('runs every agent, in dependency order, and finishes', async () => {
    const mission = await startMission();
    expect(mission.reference).toMatch(/^MISSION-\d{4}-\d{3}$/);
    expect(mission.engine).toBe('simulation');

    const detail = await waitForStatus(mission.id, ['completed']);
    const runs = detail.runs as { agentId: string; status: string; startedAt: string }[];

    const finished = runs.filter((run) => run.status === 'completed');
    expect(finished.map((run) => run.agentId)).toContain('task_manager');
    expect(finished.map((run) => run.agentId)).toContain('chief_ai');

    // An agent must never start before the work it was supposed to read.
    const firstStart = new Map<string, number>();
    for (const run of runs) {
      const at = new Date(run.startedAt).getTime();
      firstStart.set(run.agentId, Math.min(firstStart.get(run.agentId) ?? at, at));
    }
    expect(firstStart.get('task_manager')!).toBeLessThanOrEqual(firstStart.get('research')!);
    expect(firstStart.get('research')!).toBeLessThanOrEqual(firstStart.get('competitor')!);
    expect(firstStart.get('chief_ai')!).toBeGreaterThanOrEqual(firstStart.get('strategy')!);
  }, 30_000);

  it('stores the exact input each agent was given, so an answer can be explained', async () => {
    const mission = await startMission();
    const detail = await waitForStatus(mission.id, ['completed']);
    const runs = detail.runs as { id: string; agentId: string }[];
    const research = runs.find((run) => run.agentId === 'research');
    expect(research).toBeDefined();

    // The envelope is fetched on demand rather than inlined into the mission
    // response, because it carries every upstream agent's full output.
    const response = await request(app)
      .get(`/api/island/missions/${mission.id}/runs/${research!.id}`)
      .set(auth(merchant.ownerToken))
      .expect(200);

    expect(response.body.run.input.original_task).toContain('Maldives');
    expect(response.body.run.input.previous_outputs.length).toBeGreaterThan(0);
    expect(response.body.run.input.previous_outputs[0].agent).toBe('task_manager');
  }, 30_000);

  it('records a challenge from one agent against another', async () => {
    const mission = await startMission();
    const detail = await waitForStatus(mission.id, ['completed']);
    const corrections = detail.corrections as { fromAgent: string; toAgent: string; originalClaim: string }[];
    expect(corrections.length).toBeGreaterThan(0);
    // A challenge is only meaningful if it names someone else's work.
    expect(corrections.some((entry) => entry.fromAgent !== entry.toAgent)).toBe(true);
    expect(corrections.every((entry) => entry.originalClaim.length > 0)).toBe(true);
  }, 30_000);

  it('sends failed work back and runs the verification gate more than once', async () => {
    const mission = await startMission();
    const detail = await waitForStatus(mission.id, ['completed']);
    const runs = detail.runs as { agentId: string; round: number }[];

    const gateRounds = runs.filter((run) => run.agentId === 'risk_verification');
    expect(gateRounds.length).toBeGreaterThan(1);
    expect(Math.max(...runs.map((run) => run.round))).toBeGreaterThan(0);

    const events = detail.events as { type: string }[];
    expect(events.map((event) => event.type)).toContain('correction_requested');
  }, 30_000);

  it('keeps a gapless event timeline that starts and ends where it should', async () => {
    const mission = await startMission();
    const detail = await waitForStatus(mission.id, ['completed']);
    const events = detail.events as { seq: number; type: string }[];

    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    expect(events[0]!.type).toBe('mission_created');
    expect(events.at(-1)!.type).toBe('mission_completed');
  }, 30_000);
});

describe('the report the user is handed', () => {
  it('answers with a decision, a confidence and the reason it is not certain', async () => {
    const mission = await startMission();
    await waitForStatus(mission.id, ['completed']);

    const response = await request(app)
      .get(`/api/island/missions/${mission.id}/report`)
      .set(auth(merchant.ownerToken))
      .expect(200);
    const report = response.body.report;

    expect(['proceed', 'proceed_with_caution', 'more_research', 'do_not_proceed']).toContain(
      report.recommendation.decision,
    );
    expect(report.overall_confidence).toBeGreaterThanOrEqual(0);
    expect(report.overall_confidence).toBeLessThanOrEqual(1);
    expect(report.confidence_explanation.length).toBeGreaterThan(0);
    expect(report.agent_summary.length).toBeGreaterThan(0);
  }, 30_000);

  it('says on the report itself that nothing here was researched', async () => {
    const mission = await startMission();
    await waitForStatus(mission.id, ['completed']);
    const response = await request(app)
      .get(`/api/island/missions/${mission.id}/report`)
      .set(auth(merchant.ownerToken))
      .expect(200);

    // This is the single most important assertion in the suite. A simulated run
    // that reads like research is worse than no run at all.
    expect(response.body.report.engine).toBe('simulation');
    expect(response.body.report.simulation_notice.length).toBeGreaterThan(20);
    expect(response.body.report.simulation_notice.toLowerCase()).toMatch(/no model|simulation|demonstration/);
  }, 30_000);

  it('invents no source when it did no research', async () => {
    const mission = await startMission();
    const detail = await waitForStatus(mission.id, ['completed']);
    expect(detail.sources).toEqual([]);

    const report = (
      await request(app)
        .get(`/api/island/missions/${mission.id}/report`)
        .set(auth(merchant.ownerToken))
        .expect(200)
    ).body.report;
    expect(report.sources).toEqual([]);
    // Nothing may claim to be verified when there is no source behind it.
    for (const finding of report.key_findings) {
      expect(finding.label).not.toBe('VERIFIED');
    }
  }, 30_000);

  it('carries what could not be resolved into the report rather than dropping it', async () => {
    const mission = await startMission();
    await waitForStatus(mission.id, ['completed']);
    const report = (
      await request(app)
        .get(`/api/island/missions/${mission.id}/report`)
        .set(auth(merchant.ownerToken))
        .expect(200)
    ).body.report;

    expect(Array.isArray(report.unresolved_issues)).toBe(true);
    expect(Array.isArray(report.unresolved_questions)).toBe(true);
    expect(report.verification.rounds_used).toBeGreaterThan(0);
  }, 30_000);

  it('downloads as markdown a person can read', async () => {
    const mission = await startMission();
    await waitForStatus(mission.id, ['completed']);
    const response = await request(app)
      .get(`/api/island/missions/${mission.id}/report?format=markdown`)
      .set(auth(merchant.ownerToken))
      .expect(200);

    expect(response.headers['content-type']).toMatch(/text\/markdown/);
    expect(response.text).toContain(mission.reference);

    // Every section the brief asks for has to be there, whatever the heading
    // style: a report missing one of these is not the report that was promised.
    const document = response.text.toLowerCase();
    for (const section of [
      'executive summary',
      'key findings',
      'research',
      'competitor',
      'market',
      'analysis',
      'risk',
      'financial',
      'verification',
      'strategy',
      'recommend',
      'action plan',
      'assumption',
      'unresolved',
      'confidence',
      'source',
      'agent',
    ]) {
      expect(document, `the report is missing its ${section} section`).toContain(section);
    }
  }, 30_000);

  it('refuses to hand over a report a mission has not produced', async () => {
    const mission = await startMission({ start: false });
    await request(app)
      .get(`/api/island/missions/${mission.id}/report`)
      .set(auth(merchant.ownerToken))
      .expect(404);
  });
});

describe('the controls the user has over a running mission', () => {
  it('stops for a human at every gate in approval mode', async () => {
    const mission = await startMission({ mode: 'approval' });
    const waiting = await waitForStatus(mission.id, ['awaiting_approval']);
    expect(waiting.mission.pendingApprovalStage).toBeTruthy();

    const events = waiting.events as { type: string }[];
    expect(events.map((event) => event.type)).toContain('approval_required');

    // It must still be waiting a moment later: a gate that releases itself is
    // not a gate.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const still = await request(app)
      .get(`/api/island/missions/${mission.id}`)
      .set(auth(merchant.ownerToken))
      .expect(200);
    expect(still.body.mission.status).toBe('awaiting_approval');
  }, 30_000);

  it('runs on once a gate is approved, and reaches the end', async () => {
    const mission = await startMission({ mode: 'approval' });

    for (let gate = 0; gate < 12; gate += 1) {
      const detail = await waitForStatus(mission.id, ['awaiting_approval', 'completed', 'failed']);
      if (detail.mission.status !== 'awaiting_approval') break;
      await request(app)
        .post(`/api/island/missions/${mission.id}/approve`)
        .set(auth(merchant.ownerToken))
        .send({ note: 'Looks right to me.' })
        .expect(200);
    }

    const final = await waitForStatus(mission.id, ['completed']);
    expect(final.mission.status).toBe('completed');
  }, 45_000);

  it('aborts on request and stays aborted', async () => {
    const mission = await startMission();
    await request(app)
      .post(`/api/island/missions/${mission.id}/abort`)
      .set(auth(merchant.ownerToken))
      .expect(200);

    const detail = await waitForStatus(mission.id, ['aborted']);
    expect(detail.mission.status).toBe('aborted');
    await new Promise((resolve) => setTimeout(resolve, 400));

    const after = await request(app)
      .get(`/api/island/missions/${mission.id}`)
      .set(auth(merchant.ownerToken))
      .expect(200);
    // An aborted mission must not quietly finish in the background.
    expect(after.body.mission.status).toBe('aborted');
  }, 30_000);

  it('will not delete a mission that is still running', async () => {
    const mission = await startMission();
    await request(app)
      .delete(`/api/island/missions/${mission.id}`)
      .set(auth(merchant.ownerToken))
      .expect(409);
  });
});

describe('what the island refuses to do', () => {
  it('rejects a task too thin to work with', async () => {
    await request(app)
      .post('/api/island/missions')
      .set(auth(merchant.ownerToken))
      .send({ task: '   ' })
      .expect(400);
  });

  it('keeps staff out of the money-spending endpoints', async () => {
    const staff = await addStaff(app, merchant, 'staff');
    await request(app)
      .post('/api/island/missions')
      .set(auth(staff.token))
      .send({ task: 'Look into opening a second location in Male.' })
      .expect(403);
  });

  it('lets staff read a mission their manager started', async () => {
    const mission = await startMission({ start: false });
    const staff = await addStaff(app, merchant, 'staff');
    await request(app)
      .get(`/api/island/missions/${mission.id}`)
      .set(auth(staff.token))
      .expect(200);
  });

  it('will not let the three agents that keep it honest be switched off', async () => {
    for (const agentId of ['task_manager', 'risk_verification', 'chief_ai']) {
      await request(app)
        .patch(`/api/island/agents/${agentId}`)
        .set(auth(merchant.ownerToken))
        .send({ enabled: false })
        .expect(400);
    }
  });

  it('says which engine is answering before a mission is ever started', async () => {
    const response = await request(app)
      .get('/api/island/agents')
      .set(auth(merchant.ownerToken))
      .expect(200);
    expect(response.body.engine).toBe('simulation');
    expect(response.body.simulation).toBe(true);

    const agents = response.body.agents as {
      definition: { id: string; core: boolean; systemPrompt?: string };
      enabled: boolean;
    }[];
    expect(agents.length).toBeGreaterThanOrEqual(14);
    // A merchant is entitled to read the instructions an agent is given before
    // it goes and acts on their question.
    expect(agents.every((entry) => (entry.definition.systemPrompt ?? '').length > 200)).toBe(true);
  });
});
