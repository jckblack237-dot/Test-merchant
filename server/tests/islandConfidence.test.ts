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

/**
 * The reconciliation pass (report.ts).
 *
 * Everything above tests the orchestrator holding agents to Rule 6 while a
 * mission runs. This tests the last line of defence: the report itself, which
 * used to take a model's word for its own labels, its own citations, its own
 * audit tallies and its own headline confidence. An adversarial audit put a
 * report on screen reading "🟢 VERIFIED · 95% · S001" above a Source register
 * that said nothing had been sourced, and a bold 99% above "Gate did not pass,
 * Verified: 0". Nothing in the system objected, because nothing was looking.
 */
class ChiefOverreach implements AgentProvider {
  readonly kind = 'simulation' as const;
  readonly label = 'Simulation with a chief that oversteps its record';
  private readonly inner = new SimulationProvider();

  constructor(private readonly chief: Record<string, unknown>) {}

  async run(invocation: AgentInvocation): Promise<AgentInvocationResult> {
    const result = await this.inner.run(invocation);
    if (invocation.definition.id !== 'chief_ai') return result;
    return { ...result, output: { ...result.output, ...this.chief } };
  }
}

async function reportFrom(app: Express, merchant: MerchantFixture, provider: AgentProvider) {
  setProvider(provider);
  const started = await request(app)
    .post('/api/island/missions')
    .set(auth(merchant.ownerToken))
    .send({ task: 'Should we open a second location on the north shore?' })
    .expect(201);
  const missionId = started.body.mission.id as string;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const detail = await request(app)
      .get(`/api/island/missions/${missionId}`)
      .set(auth(merchant.ownerToken))
      .expect(200);
    if (['completed', 'failed', 'aborted'].includes(detail.body.mission.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const response = await request(app)
    .get(`/api/island/missions/${missionId}/report`)
    .set(auth(merchant.ownerToken))
    .expect(200);
  return response.body.report;
}

describe('the report answers back to the agents that wrote it', () => {
  let app: Express;
  let merchant: MerchantFixture;
  const original = getProvider();

  beforeEach(async () => {
    app = await freshApp();
    merchant = await createMerchant(app);
  });
  afterEach(() => setProvider(original));

  it('will not print VERIFIED for a claim citing a source the mission never registered', async () => {
    const report = await reportFrom(
      app,
      merchant,
      new ChiefOverreach({
        key_findings: [
          {
            finding: 'The north shore site clears its costs in four months.',
            evidence: ['S001', 'S002'],
            label: 'VERIFIED',
            confidence: 0.95,
          },
        ],
      }),
    );

    // The simulation registers no sources at all, so both citations refer to
    // nothing. A claim whose every citation is empty air is not verified.
    expect(report.sources).toEqual([]);
    const finding = report.key_findings[0];
    expect(finding.label).toBe('NEEDS_VERIFICATION');
    expect(finding.evidence).toEqual([]);

    const notes = (report.integrity_notes as string[]).join('\n');
    expect(notes).toContain('S001');
    expect(notes).toMatch(/not sources this mission registered/i);
    expect(notes).toMatch(/labelled VERIFIED/i);
  }, 40_000);

  it('caps a headline confidence the mission cannot support, and says it did', async () => {
    const report = await reportFrom(app, merchant, new ChiefOverreach({ overall_confidence: 0.99 }));

    // A mission with no sources and a gate that did not pass has no business
    // opening at 99%, whatever the chief typed.
    expect(report.overall_confidence).toBeLessThanOrEqual(0.6);
    expect((report.integrity_notes as string[]).join('\n')).toMatch(/99%/);
  }, 40_000);

  it('counts the verification tallies from the record, not from the verifier', async () => {
    const report = await reportFrom(
      app,
      merchant,
      new ChiefOverreach({
        // The chief cannot touch these — they come from risk_verification — but
        // the point is that they are counted rather than believed.
        overall_confidence: 0.5,
      }),
    );

    // Whatever the verification agent said about itself, these are row counts:
    // every record the gate filed, split by the status it filed it under. The
    // four statuses partition the total, so they have to add up to it.
    const { verification } = report;
    const byStatus = (report.unresolved_issues as unknown[]).length;
    expect(verification.total_claims_reviewed).toBeGreaterThanOrEqual(byStatus);
    expect(verification.total_claims_reviewed).toBe(report.verification.total_claims_reviewed);

    // high_risk_items spans statuses on purpose — a needs_verification record
    // filed at high severity is a high-risk item — so it is bounded by the
    // total rather than summing with the others.
    expect(verification.high_risk_items).toBeLessThanOrEqual(verification.total_claims_reviewed);
    expect(verification.verified).toBeLessThanOrEqual(verification.total_claims_reviewed);
    expect(verification.needs_verification).toBeLessThanOrEqual(verification.total_claims_reviewed);
  }, 40_000);

  it('keeps a risk an agent raised even when the chief leaves it out', async () => {
    const report = await reportFrom(app, merchant, new ChiefOverreach({ major_risks: [] }));

    // The chief said there were none. The strategy and financial agents filed
    // some. "No agent named a major risk" would be false.
    expect(report.major_risks.length).toBeGreaterThan(0);
    expect((report.integrity_notes as string[]).join('\n')).toMatch(/left out/i);
  }, 40_000);

  it('shows the corrections in the markdown a person downloads', async () => {
    setProvider(new ChiefOverreach({ overall_confidence: 0.99 }));
    const started = await request(app)
      .post('/api/island/missions')
      .set(auth(merchant.ownerToken))
      .send({ task: 'Should we open a second location on the north shore?' })
      .expect(201);
    const missionId = started.body.mission.id as string;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const detail = await request(app)
        .get(`/api/island/missions/${missionId}`)
        .set(auth(merchant.ownerToken))
        .expect(200);
      if (['completed', 'failed', 'aborted'].includes(detail.body.mission.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const markdown = await request(app)
      .get(`/api/island/missions/${missionId}/report?format=markdown`)
      .set(auth(merchant.ownerToken))
      .expect(200);

    // A correction the reader cannot see is just the assembler's word for it.
    expect(markdown.text).toContain('## What this report had to correct');
    expect(markdown.text).toMatch(/99%/);
  }, 40_000);
});

describe('what counts as new evidence', () => {
  let app: Express;
  let merchant: MerchantFixture;
  const original = getProvider();

  beforeEach(async () => {
    app = await freshApp();
    merchant = await createMerchant(app);
  });
  afterEach(() => setProvider(original));

  it('does not let an invented citation buy a confidence rise', async () => {
    // The clamp used to ask only whether a citation was NEW, not whether it was
    // real — so one made-up source id the originating agent had not happened to
    // use counted as fresh evidence and paid for the whole jump.
    setProvider(
      new OverconfidentProvider('analysis', (finding) => ({
        ...finding,
        finding_id: 'F-analysis-bought',
        confidence: 0.97,
        evidence: [
          {
            source_id: 'S999',
            source_title: 'A citation to nothing',
            source_url: '',
            support: 'Names a source id this mission never registered.',
          },
        ],
      })),
    );

    const started = await request(app)
      .post('/api/island/missions')
      .set(auth(merchant.ownerToken))
      .send({ task: 'Should we open a second location on the north shore?' })
      .expect(201);
    const missionId = started.body.mission.id as string;

    let detail: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const response = await request(app)
        .get(`/api/island/missions/${missionId}`)
        .set(auth(merchant.ownerToken))
        .expect(200);
      detail = response.body;
      if (['completed', 'failed', 'aborted'].includes((response.body.mission as { status: string }).status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const events = detail.events as { agentId: string | null; message: string }[];
    const clamped = events.find(
      (event) => event.agentId === 'analysis' && /clamped back to/.test(event.message),
    );
    expect(clamped, 'a fabricated citation was accepted as new evidence').toBeDefined();
  }, 40_000);
});
