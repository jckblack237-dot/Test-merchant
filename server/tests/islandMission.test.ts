import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireAgent } from '../src/island/agents/registry';
import {
  setMarketDataProvider,
  type MarketDataProvider,
  type PriceSeries,
} from '../src/island/marketData';
import { buildUserMessage, setProvider, SimulationProvider } from '../src/island/provider';
import type {
  AgentInvocation,
  AgentInvocationResult,
  AgentProvider,
  MissionEnvelope,
} from '../src/island/types';
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
  // simulation provider — the same orchestrator, no model calls. No market data
  // key either, so the price feed starts out as it does on a default install:
  // absent.
  setProvider(null);
  setMarketDataProvider(null);
  app = freshApp();
  merchant = await createMerchant(app);
});

afterEach(() => {
  setProvider(null);
  setMarketDataProvider(null);
});

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

/**
 * The price feed, and who is allowed to see it.
 *
 * These missions ask for the forex desk by name, because it is off by default.
 * What is being proved is narrow and worth proving: prices reach exactly one
 * agent's envelope, a mission with no feed still finishes and says it had none,
 * and either way the timeline records which of the two happened. An agent that
 * quietly received prices, or quietly did not, would be the one failure this
 * product cannot recover from.
 */
const FOREX_ROSTER = [
  'task_manager',
  'market_context',
  'technical_analysis',
  'risk_verification',
  'chief_ai',
];

const TEST_CANDLES = [
  { time: '2026-09-09T00:00:00Z', open: 1.1712, high: 1.1748, low: 1.1699, close: 1.1735 },
  { time: '2026-09-10T00:00:00Z', open: 1.1735, high: 1.1761, low: 1.1708, close: 1.1714 },
  { time: '2026-09-11T00:00:00Z', open: 1.1714, high: 1.1729, low: 1.1663, close: 1.1681 },
];

interface TimelineEvent {
  agentId: string | null;
  message: string;
  payload: Record<string, unknown>;
}

interface FetchCall {
  symbol: string;
  interval: string;
  limit: number;
}

/** A feed that answers instantly and records what it was asked for, so the test
 *  can check the pair the orchestrator resolved rather than guess at it. */
function testFeed(calls: FetchCall[]): MarketDataProvider {
  return {
    id: 'test_feed',
    label: 'Test feed',
    async fetchSeries(symbol, interval, limit) {
      calls.push({ symbol, interval, limit });
      return {
        symbol,
        interval,
        candles: TEST_CANDLES,
        provider: 'Test feed',
        fetchedAt: '2026-09-12T06:00:00Z',
      };
    },
  };
}

/**
 * The simulation's Task Manager plans the core roster and nothing else, so its
 * plan narrows a forex mission back off the desk before it ever reaches it.
 * This wrapper puts the mission's own roster into that plan and changes nothing
 * else: every agent still answers from the simulation, with no model and no
 * research behind it.
 */
class ForexDeskPlanner implements AgentProvider {
  readonly kind = 'simulation' as const;
  readonly label = 'Simulation — no model, no web access';

  private readonly inner = new SimulationProvider();

  async run(invocation: AgentInvocation): Promise<AgentInvocationResult> {
    const result = await this.inner.run(invocation);
    if (invocation.definition.id !== 'task_manager') return result;
    return {
      ...result,
      output: {
        ...result.output,
        required_agents: FOREX_ROSTER.map((agentId) => ({
          agent_id: agentId,
          reason: 'Named by the mission that was started.',
          required: true,
        })),
        execution_order: [...FOREX_ROSTER],
      },
    };
  }
}

function startForexMission(body: Record<string, unknown> = {}) {
  setProvider(new ForexDeskPlanner());
  return startMission({
    task: 'Give me a read on EUR/USD ahead of the next ECB meeting, and say what would prove it wrong.',
    agents: FOREX_ROSTER,
    ...body,
  });
}

async function envelopeOf(missionId: string, runId: string) {
  const response = await request(app)
    .get(`/api/island/missions/${missionId}/runs/${runId}`)
    .set(auth(merchant.ownerToken))
    .expect(200);
  return response.body.run.input as MissionEnvelope;
}

describe('prices, and the agents that do not get them', () => {
  it('gives market_data to the agent that asked for it and to nobody else', async () => {
    const calls: FetchCall[] = [];
    setMarketDataProvider(testFeed(calls));

    const mission = await startForexMission();
    const detail = await waitForStatus(mission.id, ['completed']);
    const runs = detail.runs as { id: string; agentId: string; status: string }[];

    // The pair came out of the mission, normalised, and the window came out of
    // the island's own configuration. Once, however many rounds the agent ran:
    // a fetch is somebody's rate limit and somebody's money.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.symbol).toBe('EUR/USD');
    expect(calls[0]!.interval).toBe('1day');
    expect(calls[0]!.limit).toBe(120);

    let sawTechnical = false;
    for (const run of runs) {
      const envelope = await envelopeOf(mission.id, run.id);
      if (run.agentId === 'technical_analysis') {
        sawTechnical = true;
        expect(envelope.market_data?.symbol).toBe('EUR/USD');
        expect(envelope.market_data?.candles.length).toBe(TEST_CANDLES.length);
      } else {
        expect(envelope.market_data, `${run.agentId} was handed prices it never asked for`).toBeUndefined();
      }
    }
    expect(sawTechnical).toBe(true);
  }, 40_000);

  it('records the fetch in the source register and in the timeline', async () => {
    setMarketDataProvider(testFeed([]));

    const mission = await startForexMission();
    const detail = await waitForStatus(mission.id, ['completed']);

    // A price that shaped a thesis has to be traceable like any other evidence:
    // provider, symbol, interval and the time it was retrieved.
    const sources = detail.sources as { title: string; source_type: string }[];
    // One entry however many times the agent ran: a correction round re-reads
    // the same candles, it does not acquire them again.
    const priceSources = sources.filter((source) => source.title.includes('EUR/USD'));
    expect(priceSources.length).toBe(1);
    const priceSource = priceSources[0];
    expect(priceSource).toBeDefined();
    expect(priceSource!.title).toContain('1day');
    expect(priceSource!.title).toContain('Test feed');
    expect(priceSource!.title).toContain('2026-09-12T06:00:00Z');

    const events = detail.events as TimelineEvent[];
    const retrieved = events.find(
      (event) => event.agentId === 'technical_analysis' && event.payload.market_data === true,
    );
    expect(retrieved).toBeDefined();
    expect(retrieved!.payload.symbol).toBe('EUR/USD');
    expect(retrieved!.payload.candles).toBe(TEST_CANDLES.length);
    expect(retrieved!.payload.provider).toBe('Test feed');
  }, 40_000);

  it('finishes with no feed configured, and says in the timeline that there was none', async () => {
    // No provider is the default state of an install, and it must stay a
    // working one — quieter about the gap than it is today would be worse than
    // failing outright.
    const mission = await startForexMission();
    const detail = await waitForStatus(mission.id, ['completed']);

    const runs = detail.runs as { id: string; agentId: string; status: string }[];
    const technical = runs.filter((run) => run.agentId === 'technical_analysis');
    expect(technical.length).toBeGreaterThan(0);
    expect(technical.some((run) => run.status === 'completed')).toBe(true);

    for (const run of technical) {
      const envelope = await envelopeOf(mission.id, run.id);
      expect(envelope.market_data).toBeUndefined();
    }

    const events = detail.events as TimelineEvent[];
    const gap = events.find(
      (event) => event.agentId === 'technical_analysis' && event.payload.market_data === false,
    );
    expect(gap, 'a mission that fetched no prices must say so').toBeDefined();
    expect(gap!.payload.reason).toBe('no_provider');
    expect(gap!.payload.symbol).toBe('EUR/USD');
    expect(gap!.message).toMatch(/no market data feed/i);

    // Nothing was retrieved, so nothing may appear in the register.
    expect(detail.sources).toEqual([]);
  }, 40_000);

  it('says there are no prices when the mission names no pair to fetch', async () => {
    setMarketDataProvider(testFeed([]));

    const mission = await startForexMission({
      task: 'Tell me whether opening a second coffee shop in the north of the island is worth doing.',
    });
    const detail = await waitForStatus(mission.id, ['completed']);

    const events = detail.events as TimelineEvent[];
    const gap = events.find(
      (event) => event.agentId === 'technical_analysis' && event.payload.market_data === false,
    );
    expect(gap).toBeDefined();
    expect(gap!.payload.reason).toBe('no_pair');
    expect(detail.sources).toEqual([]);
  }, 40_000);
});

describe('what the price data looks like to the model', () => {
  const series: PriceSeries = {
    symbol: 'EUR/USD',
    interval: '1day',
    candles: TEST_CANDLES,
    provider: 'Test feed',
    fetchedAt: '2026-09-12T06:00:00Z',
  };

  function envelopeWith(marketData: PriceSeries | undefined): MissionEnvelope {
    return {
      mission_id: 'm_1',
      mission_reference: 'MISSION-2026-001',
      original_task: 'Give me a read on EUR/USD.',
      objective: 'Read the structure on EUR/USD.',
      user_requirements: [],
      constraints: [],
      geography: 'Germany',
      language: 'English',
      currency: 'EUR',
      current_stage: 'analyse',
      previous_agent: 'market_context',
      previous_outputs: [],
      handoffs: [],
      research_questions: [],
      available_sources: [],
      ...(marketData ? { market_data: marketData } : {}),
      instructions: '',
    };
  }

  it('renders every candle it was given, unrounded', () => {
    const message = buildUserMessage(requireAgent('technical_analysis'), envelopeWith(series));

    expect(message).toContain('- Symbol: EUR/USD');
    expect(message).toContain('- Interval: 1day');
    expect(message).toContain('- Provider: Test feed');
    expect(message).toContain('- Retrieved at: 2026-09-12T06:00:00Z');
    expect(message).toContain('time,open,high,low,close');
    for (const candle of TEST_CANDLES) {
      expect(message).toContain(
        `${candle.time.slice(0, 10)},${candle.open},${candle.high},${candle.low},${candle.close}`,
      );
    }
  });

  it('tells an agent that expected prices when there are none, and stays silent to everyone else', () => {
    const technical = buildUserMessage(requireAgent('technical_analysis'), envelopeWith(undefined));
    expect(technical).toContain('No price data reached this mission');
    expect(technical).not.toContain('time,open,high,low,close');

    // An agent that never asked for prices is told nothing about them either
    // way: it has no price section to explain and no gap to fill.
    const research = buildUserMessage(requireAgent('research'), envelopeWith(undefined));
    expect(research).not.toContain('Live price data');
    expect(research).not.toContain('No price data reached this mission');
  });
});
