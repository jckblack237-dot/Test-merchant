/**
 * Follow-up questions about a finished mission.
 *
 * The rule here is narrower than it looks: the answer may come from the mission
 * package and from nowhere else. A model asked "what would this cost in Berlin?"
 * will happily answer from what it knows about Berlin, and that answer would
 * arrive wearing the mission's authority — sourced, verified, corrected — while
 * being none of those things. So the question is put to the model alongside the
 * report and the agent outputs, with instructions to answer only from them and
 * to say plainly when the mission does not contain the answer, and the shape it
 * has to return includes a field for exactly that admission.
 *
 * On the simulation engine there is nothing to ask and nothing to answer from,
 * so this refuses outright rather than producing a fluent nothing.
 */
import type { TenantStore } from '../db/tenant';
import { getProvider } from './provider';
import { latestRunByAgent, listSources } from './store';
import type {
  AgentDefinition,
  AgentOutput,
  JsonSchema,
  MissionEnvelope,
  MissionRecord,
} from './types';

const SYSTEM_PROMPT = [
  'You answer questions about a finished mission run by the AI Agent Island, a multi-agent research',
  'pipeline. You are not one of its agents and you are not doing new research.',
  '',
  'The mission package below — the final report, the complete output of every agent that ran, and the',
  'source register — is the only material you may answer from. It is not a starting point you may',
  'build on with what you happen to know.',
  '',
  'How to answer:',
  '- Quote what the mission actually established, and name the agent or the source id it came from.',
  '- Carry the labels and confidences across unchanged. A NEEDS_VERIFICATION finding does not become',
  '  settled because someone asked about it directly.',
  '- Where the mission answers only part of the question, answer that part and say which part it does',
  '  not reach.',
  '- Where the mission does not answer it at all, say so plainly and set answered_from_mission to',
  '  false. "This mission did not look into that" is the correct answer, and a far more useful one',
  '  than a plausible paragraph that nobody researched.',
  '- Never introduce a figure, a company, a price, a date or a source that is not in the package.',
].join('\n');

const FOLLOWUP_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      description:
        'Your answer, drawn only from the mission package. If the mission does not answer the ' +
        'question, say that here in plain words rather than answering it from elsewhere.',
    },
    answered_from_mission: {
      type: 'boolean',
      description: 'True only if the mission material genuinely answers the question.',
    },
    references: {
      type: 'array',
      description: 'Agent ids, finding ids or source ids your answer rests on. Empty if none apply.',
      items: { type: 'string' },
      maxItems: 20,
    },
    what_is_missing: {
      type: 'string',
      description:
        'What the mission would have had to find out to answer this properly. "" if it answered it.',
    },
  },
  required: ['answer', 'answered_from_mission', 'references', 'what_is_missing'],
  additionalProperties: false,
};

/** A stand-in definition so the follow-up runs through the same provider, the
 *  same forced-tool shaping and the same schema gate as every agent does. */
const FOLLOWUP_AGENT: AgentDefinition = {
  id: 'mission_followup',
  name: 'Mission follow-up',
  emoji: '💬',
  role: 'Answering from the finished mission',
  stage: 'review',
  dependsOn: [],
  core: false,
  enabledByDefault: false,
  webSearch: false,
  systemPrompt: SYSTEM_PROMPT,
  outputSchema: FOLLOWUP_SCHEMA,
  map: { x: 0, y: 0 },
  summary: 'Answers a question about a completed mission, strictly from what that mission produced.',
};

const NO_MODEL =
  'Follow-up questions need a configured model. This mission ran on the simulation engine, which ' +
  'produced structure rather than research, so there is nothing here to answer from and nothing ' +
  'running that could answer it. Set ANTHROPIC_API_KEY and run the mission again.';

const NO_REPORT =
  'This mission has no final report, so there is nothing to answer from yet. Follow-up questions can ' +
  'only be answered once a mission has completed.';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asText).filter(Boolean) : [];
}

export async function answerFollowup(
  store: TenantStore,
  mission: MissionRecord,
  question: string,
): Promise<string> {
  const asked = question.trim();
  if (!asked) return 'No question was asked.';
  if (!mission.finalReport) return NO_REPORT;

  const provider = getProvider();
  if (provider.kind !== 'claude') return NO_MODEL;

  const runs = latestRunByAgent(store, mission.id);
  const outputs: AgentOutput[] = [];
  for (const run of Object.values(runs)) {
    if (run.status === 'completed' && run.output) outputs.push(run.output);
  }

  // The report goes in as one more "previous output" because the envelope
  // renders those verbatim, which is exactly what a document being quoted from
  // needs — no summarising step between it and the answer.
  const reportPackage = {
    mission_id: mission.id,
    agent: 'final_report',
    status: 'completed' as const,
    findings: [],
    evidence: [],
    issues: [],
    assumptions: [],
    recommendations: [],
    next_agent_instructions: '',
    confidence: mission.confidence ?? 0,
    final_report: mission.finalReport,
  };

  const envelope: MissionEnvelope = {
    mission_id: mission.id,
    mission_reference: mission.reference,
    original_task: mission.userTask,
    objective: mission.objective,
    user_requirements: mission.userRequirements,
    constraints: mission.constraints,
    geography: mission.geography,
    language: mission.language,
    currency: mission.currency,
    current_stage: 'review',
    previous_agent: null,
    previous_outputs: [reportPackage, ...outputs],
    handoffs: [],
    research_questions: [],
    available_sources: listSources(store, mission.id),
    instructions: [
      'The person who ran this mission has asked a follow-up question about it:',
      '',
      asked,
      '',
      'Answer it from the mission package above and from nothing else. If the mission does not answer',
      'it, say so and set answered_from_mission to false.',
    ].join('\n'),
  };

  try {
    const result = await provider.run({ definition: FOLLOWUP_AGENT, envelope });
    const output = result.output as Record<string, unknown>;
    const answer = asText(output.answer);
    if (!answer) {
      return 'The model returned no answer to this question. Nothing in the mission was changed.';
    }

    const references = asList(output.references);
    const missingFrom = asText(output.what_is_missing);
    const answered = output.answered_from_mission === true;

    const parts = [answer];
    if (references.length) parts.push(`Based on: ${references.join(', ')}.`);
    if (!answered && missingFrom) {
      parts.push(`This mission did not cover it: ${missingFrom}`);
    }
    return parts.join('\n\n');
  } catch (error) {
    // A failed follow-up is worth recording as the failure it was — an error
    // page here would lose the question along with the reason.
    const reason = error instanceof Error ? error.message : String(error);
    return `This question could not be answered: ${reason} Nothing in the mission was changed.`;
  }
}
