/**
 * What runs when no API key is configured.
 *
 * The temptation here is to make the demo look good — a few plausible
 * competitors, a market size, a tidy revenue curve. That would be the single
 * most damaging thing this codebase could do, because a report that looks like
 * research and is not gets acted on. So this provider has one absolute rule:
 * **it never invents anything.** No source, no URL, no statistic, no company
 * name, no price. Every claim it emits is labelled NEEDS_VERIFICATION, carries
 * no evidence, sits well under a 0.35 confidence ceiling, and says in plain
 * words that it came from a pipeline demonstration with no model behind it.
 *
 * What it does do is exercise the real machinery, so that running without a key
 * still proves the engine works: it shapes output from each agent's own JSON
 * Schema (so a newly added agent needs no code here at all), it raises a
 * genuine challenge against an upstream finding, and it fails verification on
 * the first round so the correction loop actually runs end to end.
 */
import { CORE_AGENT_IDS } from '../agents/registry';
import { CORRECTION_SCHEMA } from '../schemas';
import type {
  AgentDefinition,
  AgentInvocation,
  AgentInvocationResult,
  AgentOutput,
  AgentProvider,
  Finding,
  Issue,
  JsonSchema,
  MissionEnvelope,
} from '../types';
import { AgentFailure } from '../types';
import { normaliseAndValidate } from '../validate';

/** Low enough that nothing here can be mistaken for a supported claim. */
const DEMO_CONFIDENCE = 0.2;

const NOT_PRODUCED =
  'Not produced. This mission ran as a pipeline demonstration, with no model and no web access.';

const DEMO_CLAIM =
  'Nothing was researched on this run. The island ran with no model and no web access, so this ' +
  'output is structure only and contains no research of any kind.';

/**
 * When a schema pins a field to a fixed set of values the simulation still has
 * to pick one. Whatever the field means, it picks the option that claims the
 * least, so a demonstration run can never read as a confident answer.
 */
const MODEST_VALUES = ['NEEDS_VERIFICATION', 'more_research', 'estimated', 'unknown', 'other', 'low'];

function chooseEnum(values: (string | number)[]): string {
  for (const preferred of MODEST_VALUES) {
    if (values.includes(preferred)) return preferred;
  }
  return String(values[0] ?? '');
}

/**
 * Walks any schema in our dialect and fills every field with an honest
 * placeholder of the right type. This is what lets a specialist agent added
 * later work here with no changes to this file.
 */
function placeholder(schema: JsonSchema): unknown {
  switch (schema.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        out[key] = placeholder(child);
      }
      return out;
    }

    case 'array': {
      // An empty list is the honest placeholder — nothing was gathered. Only a
      // schema that insists on entries gets them.
      const items = schema.items;
      const minimum = schema.minItems ?? 0;
      if (!items || minimum < 1) return [];
      return Array.from({ length: minimum }, () => placeholder(items));
    }

    case 'string':
      return schema.enum?.length ? chooseEnum(schema.enum) : NOT_PRODUCED;

    case 'number':
    case 'integer': {
      // A field bounded to 0..1 is a confidence. Answering 0 everywhere reads
      // as a broken run rather than an honest one, so it takes the same modest
      // value every other claim here carries.
      if (schema.minimum === 0 && schema.maximum === 1) return DEMO_CONFIDENCE;
      const base = schema.minimum ?? 0;
      return schema.type === 'integer' ? Math.ceil(base) : base;
    }

    case 'boolean':
      return false;
  }
}

/** Every finding this agent can see, from its dependencies and its hand-offs. */
function upstreamFindings(envelope: MissionEnvelope): { agent: string; finding: Finding }[] {
  const seen = new Set<string>();
  const collected: { agent: string; finding: Finding }[] = [];

  const add = (agent: string, finding: Finding | undefined): void => {
    if (!finding || !finding.finding_id || seen.has(finding.finding_id)) return;
    seen.add(finding.finding_id);
    collected.push({ agent, finding });
  };

  for (const output of envelope.previous_outputs) {
    const agent = typeof output.agent === 'string' ? output.agent : '';
    if (Array.isArray(output.findings)) {
      for (const finding of output.findings) add(agent, finding);
    }
  }
  for (const handoff of envelope.handoffs) {
    for (const finding of handoff.important_findings) add(handoff.from_agent, finding);
  }
  return collected;
}

/**
 * Deterministic per agent rather than random, so the island animates the same
 * way on every run of the same mission and a screenshot is reproducible.
 */
function paceMs(agentId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < agentId.length; index += 1) {
    hash ^= agentId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 200 + ((hash >>> 0) % 401);
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export class SimulationProvider implements AgentProvider {
  readonly kind = 'simulation' as const;
  readonly label = 'Simulation — no model, no web access';

  /**
   * How many times the verification agent has run for each mission. The gate
   * has to fail once and pass once for the correction loop to be demonstrably
   * live, and the envelope carries no round number, so the provider counts.
   */
  private readonly verificationRounds = new Map<string, number>();

  async run(invocation: AgentInvocation): Promise<AgentInvocationResult> {
    const { definition, envelope, signal, onProgress } = invocation;

    onProgress?.('running without a model — producing structure, not research');
    await pause(paceMs(definition.id), signal);
    signal?.throwIfAborted();

    const correction = envelope.correction;
    const schema = correction ? CORRECTION_SCHEMA(definition.id) : definition.outputSchema;
    const draft = correction
      ? this.correctionDraft(definition, envelope)
      : this.standardDraft(definition, envelope, onProgress);

    onProgress?.(
      correction
        ? 'writing back what could not be corrected'
        : 'shaping the demonstration output into the report schema',
    );

    // The simulation is held to exactly the same gate as the live engine. If a
    // newly added agent has a schema this generic walk cannot satisfy, that is
    // a real failure and it should surface as one rather than be papered over.
    const { value, issues } = normaliseAndValidate(draft, schema);
    if (issues.length) {
      throw new AgentFailure(
        definition.id,
        `The simulation could not build output matching the ${definition.id} schema.`,
        issues,
      );
    }

    return {
      output: value as AgentOutput,
      sources: [],
      notes:
        `${definition.name} did not run. No model was called and no page was retrieved. ` +
        'This output exists so the orchestration, the hand-offs and the correction loop can be ' +
        'seen working; none of its content is research.',
      inputTokens: 0,
      outputTokens: 0,
      repairs: 0,
    };
  }

  private standardDraft(
    definition: AgentDefinition,
    envelope: MissionEnvelope,
    onProgress?: (note: string) => void,
  ): Record<string, unknown> {
    const base = placeholder(definition.outputSchema) as Record<string, unknown>;
    const challenge = this.challengeUpstream(definition, envelope);
    if (challenge) onProgress?.(`challenging ${challenge.target_finding_id} from the ${challenge.target_agent} agent`);

    const finding: Finding = {
      finding_id: `F-${definition.id}-001`,
      claim: DEMO_CLAIM,
      category: 'pipeline',
      importance: 'high',
      label: 'NEEDS_VERIFICATION',
      evidence: [],
      confidence: DEMO_CONFIDENCE,
    };

    const ownLimitation: Issue = {
      issue_id: `I-${definition.id}-000`,
      target_agent: '',
      target_finding_id: '',
      problem:
        'This entire output is placeholder structure produced without a model. Treating any part of ' +
        'it as a finding would be a mistake.',
      severity: 'high',
      required_action:
        'Configure ANTHROPIC_API_KEY and run the mission again on the Claude engine before relying ' +
        'on anything here.',
    };

    return {
      ...base,
      ...this.agentOverlay(definition, envelope),
      mission_id: envelope.mission_id,
      agent: definition.id,
      status: 'completed',
      findings: [finding],
      evidence: [],
      issues: challenge ? [challenge, ownLimitation] : [ownLimitation],
      assumptions: [
        'No model was called and no page was retrieved on this run.',
        'Every field here is placeholder structure, present so the pipeline has something to carry.',
      ],
      recommendations: [
        {
          priority: 1,
          action: 'Set ANTHROPIC_API_KEY and run this mission again before using any of it.',
          reason: 'This run produced structure, not research. Nothing in it has been established.',
        },
      ],
      next_agent_instructions:
        'Treat nothing above as input. Carry the simulation notice forward so it reaches the report.',
      confidence: DEMO_CONFIDENCE,
    };
  }

  /**
   * A real challenge against a real upstream finding, so the correction trail
   * in the audit log is genuine rather than staged. The problem it raises is
   * true: a claim produced with no research and no evidence cannot be leaned on.
   */
  private challengeUpstream(definition: AgentDefinition, envelope: MissionEnvelope): Issue | null {
    const target = upstreamFindings(envelope)[0];
    if (!target) return null;
    return {
      issue_id: `I-${definition.id}-001`,
      target_agent: target.agent,
      target_finding_id: target.finding.finding_id,
      problem:
        `${target.finding.finding_id} carries no evidence at all. It was produced on the simulation ` +
        'engine, so there is no source behind it and no way to check it.',
      severity: 'medium',
      required_action:
        'Re-run this agent on the Claude engine so the claim is either supported by a retrieved ' +
        'source or withdrawn.',
    };
  }

  /**
   * The handful of agent-specific fields that have to carry real content for
   * the pipeline to run at all. Everything else is left to the generic walk,
   * which is what keeps a newly added specialist working with no code here.
   */
  private agentOverlay(
    definition: AgentDefinition,
    envelope: MissionEnvelope,
  ): Record<string, unknown> {
    switch (definition.id) {
      case 'task_manager':
        return {
          task_definition: {
            objective: envelope.objective.trim() || envelope.original_task.trim(),
            problem_to_solve: NOT_PRODUCED,
            success_criteria: [],
            constraints: envelope.constraints,
          },
          research_questions: [
            {
              question_id: 'Q001',
              question:
                'Every question this mission needs answering is still open: nothing was researched ' +
                'on this run.',
              priority: 'high',
            },
          ],
          // The roster, not a judgement about it — the orchestrator still
          // intersects this with what the merchant actually enabled.
          required_agents: CORE_AGENT_IDS.map((agentId) => ({
            agent_id: agentId,
            reason: 'Part of the standard island roster, included so the pipeline runs end to end.',
            required: true,
          })),
          execution_order: [...CORE_AGENT_IDS],
        };

      case 'risk_verification':
        return this.verificationOverlay(envelope);

      case 'financial':
        return {
          estimate_notice:
            'Every figure above is zero because nothing was estimated. This run had no model behind it.',
        };

      case 'strategy':
        return {
          recommendation: {
            decision: 'more_research',
            reason:
              'No research was carried out, so there is nothing to base a decision on. Run the ' +
              'mission again on the Claude engine.',
          },
        };

      case 'chief_ai':
        return this.chiefOverlay(envelope);

      default:
        return {};
    }
  }

  /**
   * Fails the gate the first time and passes it the second, so the correction
   * round is genuinely triggered, genuinely run and genuinely cleared. Nothing
   * is ever reported as verified, because nothing was.
   */
  private verificationOverlay(envelope: MissionEnvelope): Record<string, unknown> {
    const reviewed = upstreamFindings(envelope);
    const round = (this.verificationRounds.get(envelope.mission_id) ?? 0) + 1;
    this.verificationRounds.set(envelope.mission_id, round);

    const corrected = envelope.previous_outputs.some((output) => output.status === 'corrected');
    const passed = reviewed.length === 0 || round > 1 || corrected;
    if (passed) this.verificationRounds.delete(envelope.mission_id);

    const first = reviewed[0];
    const flagged =
      passed || !first
        ? []
        : [
            {
              finding_id: first.finding.finding_id,
              agent: first.agent,
              reason:
                'The claim has no evidence attached and no source behind it, so it cannot be ' +
                'verified as it stands.',
              severity: 'high',
              recommended_action:
                'Send it back to its agent for correction, then run the mission on the Claude ' +
                'engine to establish it properly.',
            },
          ];

    return {
      verification_summary: {
        total_claims_reviewed: reviewed.length,
        verified: 0,
        needs_verification: reviewed.length,
        contradictions: 0,
        high_risk_items: flagged.length,
      },
      verified_findings: [],
      flagged_findings: flagged,
      contradictions: [],
      required_research: ['All of it. No research was carried out on this mission.'],
      overall_reliability: 'low',
      verification_passed: passed,
    };
  }

  private chiefOverlay(envelope: MissionEnvelope): Record<string, unknown> {
    const contributors = new Set<string>();
    for (const handoff of envelope.handoffs) contributors.add(handoff.from_agent);
    for (const output of envelope.previous_outputs) {
      if (typeof output.agent === 'string' && output.agent) contributors.add(output.agent);
    }

    return {
      executive_summary:
        'There is no answer to the question in this report. The mission ran as a pipeline ' +
        'demonstration: no model was called and no page was retrieved. The orchestration, the ' +
        'hand-offs, the challenge and the correction round all ran for real — the content did not.',
      key_findings: [],
      final_assessment: {
        decision: 'more_research',
        reason:
          'Nothing was researched, so there is nothing to decide on. Configure an API key and run ' +
          'the mission again.',
      },
      financial_summary: {
        estimated_startup_cost: 0,
        estimated_monthly_cost: 0,
        estimated_monthly_revenue: 0,
        currency: envelope.currency,
        note: 'These are zeros, not estimates. No financial work was done on this run.',
      },
      contradictions_resolved: [],
      rejected_conclusions: [],
      major_risks: [
        'The only risk in this document is mistaking it for research. There is none in it.',
      ],
      unknowns: ['Everything the mission was asked to find out.'],
      action_plan: [
        {
          priority: 1,
          action: 'Set ANTHROPIC_API_KEY and run this mission again on the Claude engine.',
          reason: 'Until then the island can show you how it works but cannot tell you anything.',
        },
      ],
      what_would_change_this: ['Running the mission with a model and live web access.'],
      overall_confidence: DEMO_CONFIDENCE,
      confidence_explanation:
        'This is not confidence in an answer. There is no answer here — only the structure one ' +
        'would arrive in.',
      agent_summary: [...contributors].map((agent) => ({
        agent,
        status: 'completed',
        key_contribution: 'Ran in simulation. Produced structure, not research.',
      })),
    };
  }

  /**
   * A correction round the simulation cannot actually satisfy — and says so.
   * Every entry comes back `resolved: false`, which is the honest answer and
   * which the orchestrator carries into the report as an unresolved issue.
   */
  private correctionDraft(
    definition: AgentDefinition,
    envelope: MissionEnvelope,
  ): Record<string, unknown> {
    const base = placeholder(CORRECTION_SCHEMA(definition.id)) as Record<string, unknown>;
    const issues = envelope.correction?.issues ?? [];

    return {
      ...base,
      mission_id: envelope.mission_id,
      agent: definition.id,
      status: 'corrected',
      corrections: issues.map((issue) => ({
        finding_id: issue.finding_id,
        previous_claim:
          'Not restated. The original claim was placeholder structure, not a researched claim.',
        corrected_claim:
          'Unchanged. With no model and no web access there is nothing to re-check it against.',
        reason_for_change: `"${issue.required_action}" cannot be carried out on the simulation engine.`,
        new_sources: [],
        resolved: false,
      })),
      findings: [
        {
          finding_id: `F-${definition.id}-C01`,
          claim:
            'The correction round ran and changed nothing, because there was no model available to ' +
            'do the work. The issues it was sent remain open.',
          category: 'pipeline',
          importance: 'high',
          label: 'NEEDS_VERIFICATION',
          evidence: [],
          confidence: DEMO_CONFIDENCE,
        },
      ],
      sources: [],
      remaining_uncertainties: [
        'Every issue raised against this agent is still open.',
        'Nothing on this mission has been established by research.',
      ],
      confidence: DEMO_CONFIDENCE,
    };
  }
}
