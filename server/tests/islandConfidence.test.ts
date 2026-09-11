/**
 * Uncertainty has to survive the pipeline (§21 rule 6).
 *
 * This is the rule that is easiest to state and easiest to quietly not
 * implement, because nothing looks broken when it fails — the report simply
 * reads more confident than the evidence behind it, which is precisely the
 * failure mode this whole system exists to prevent. So it is tested directly:
 * an agent is made to restate an earlier finding at near-certainty with no new
 * evidence, and the stored output is checked afterwards.
 */
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getProvider, setProvider, SimulationProvider } from '../src/island/provider';
import type {
  AgentInvocation,
  AgentInvocationResult,
  AgentProvider,
  Finding,
} from '../src/island/types';
import { auth, createMerchant, freshApp, type MerchantFixture } from './helpers';

/** Wraps the honest simulation engine and lets one agent overreach. */
class OverconfidentProvider implements AgentProvider {
  readonly kind = 'simulation' as const;
  readonly label = 'Simulation with one overconfident agent';
  private readonly inner = new SimulationProvider();

  constructor(
    private readonly agentId: string,
    private readonly rewrite: (finding: Finding) => Finding,
  ) {}

  async run(invocation: AgentInvocation): Promise<AgentInvocationResult> {
    const result = await this.inner.run(invocation);
    if (invocation.definition.id !== this.agentId) return result;

    // Take the claim the research agent actually made and restate it, word for
    // word, as near-certain — attaching nothing new to justify the jump.
    const upstream = invocation.envelope.previous_outputs
      .flatMap((output) => output.findings)
      .find((finding) => finding.finding_id.includes('research'));
    if (upstream) result.output.findings.push(this.rewrite(upstream));
    return result;
  }
}

let app: Express;
let merchant: MerchantFixture;

beforeEach(async () => {
  setProvider(null);
  app = freshApp();
  merchant = await createMerchant(app);
});

afterEach(() => setProvider(null));

async function runMission(): Promise<Record<string, unknown>> {
  const created = await request(app)
    .post('/api/island/missions')
    .set(auth(merchant.ownerToken))
    .send({ task: 'Assess whether a same-day courier service would work in Male.' })
    .expect(201);

  const missionId = created.body.mission.id as string;
  const deadline = Date.now() + 25_000;
  for (;;) {
    const detail = await request(app)
      .get(`/api/island/missions/${missionId}`)
      .set(auth(merchant.ownerToken))
      .expect(200);
    if (['completed', 'failed', 'aborted'].includes(detail.body.mission.status)) return detail.body;
    if (Date.now() > deadline) throw new Error(`stalled in ${detail.body.mission.status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('confidence cannot grow on its own', () => {
  it('puts a restated claim back to the confidence it was born with', async () => {
    setProvider(
      new OverconfidentProvider('analysis', (finding) => ({
        ...finding,
        finding_id: 'F-analysis-restated',
        label: 'VERIFIED',
        evidence: [],
        confidence: 0.97,
      })),
    );

    const detail = await runMission();
    const runs = detail.runs as { agentId: string; output: { findings: Finding[] } | null }[];
    const analysis = runs.find((run) => run.agentId === 'analysis');
    const restated = analysis?.output?.findings.find(
      (finding) => finding.finding_id === 'F-analysis-restated',
    );

    expect(restated, 'the overreaching finding should have been stored').toBeDefined();
    // The research agent made this claim at 0.2 on the simulation engine.
    expect(restated!.confidence).toBeLessThanOrEqual(0.2);
    expect(restated!.confidence).toBeLessThan(0.97);
  }, 40_000);

  it('says in the timeline that it clamped it, rather than doing it silently', async () => {
    setProvider(
      new OverconfidentProvider('analysis', (finding) => ({
        ...finding,
        finding_id: 'F-analysis-restated',
        evidence: [],
        confidence: 0.97,
      })),
    );

    const detail = await runMission();
    const messages = (detail.events as { message: string }[]).map((event) => event.message);
    const note = messages.find((message) => /clamped back/i.test(message));

    expect(note, 'a silent correction would be its own kind of dishonesty').toBeDefined();
    expect(note).toMatch(/without attaching new evidence/i);
  }, 40_000);

  it('leaves a higher confidence alone when genuinely new evidence came with it', async () => {
    setProvider(
      new OverconfidentProvider('analysis', (finding) => ({
        ...finding,
        finding_id: 'F-analysis-sourced',
        confidence: 0.9,
        evidence: [
          {
            source_id: 'S900',
            source_title: 'A source the research agent never had',
            source_url: 'https://example.test/new-evidence',
            support: 'States the claim directly.',
          },
        ],
      })),
    );

    const detail = await runMission();
    const runs = detail.runs as { agentId: string; output: { findings: Finding[] } | null }[];
    const sourced = runs
      .find((run) => run.agentId === 'analysis')
      ?.output?.findings.find((finding) => finding.finding_id === 'F-analysis-sourced');

    // The rule is "confidence must be justified by new evidence", not
    // "confidence may never rise" — a later agent that actually found something
    // is allowed to be more sure than the one before it.
    expect(sourced?.confidence).toBeCloseTo(0.9);
  }, 40_000);
});

describe('the provider seam', () => {
  it('falls back to the configured engine once the override is cleared', () => {
    setProvider(new OverconfidentProvider('analysis', (finding) => finding));
    expect(getProvider().label).toMatch(/overconfident/i);
    setProvider(null);
    expect(getProvider().kind).toBe('simulation');
  });
});
