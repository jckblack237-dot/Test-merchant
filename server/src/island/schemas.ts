/**
 * Output schemas for every island agent (§20).
 *
 * One object serves two purposes: it is sent to the model as the structured
 * output format, and it is what the orchestrator validates the response
 * against. Keeping a single definition means the contract the model was given
 * and the contract it is judged by can never drift apart.
 *
 * Two conventions, both required for strict structured output:
 *   - every object sets `additionalProperties: false`
 *   - every declared property is listed in `required`
 * Optionality is expressed with empty strings and empty arrays, never with a
 * missing key, so downstream code never has to guard for `undefined`.
 */
import type { JsonSchema } from './types';

// --- tiny builders ----------------------------------------------------------

const str = (description: string, maxLength?: number): JsonSchema => ({
  type: 'string',
  description,
  ...(maxLength ? { maxLength } : {}),
});

const enumOf = (values: string[], description: string): JsonSchema => ({
  type: 'string',
  description,
  enum: values,
});

const confidence = (description: string): JsonSchema => ({
  type: 'number',
  description,
  minimum: 0,
  maximum: 1,
});

const int = (description: string, minimum = 0): JsonSchema => ({
  type: 'integer',
  description,
  minimum,
});

const arrayOf = (items: JsonSchema, description: string, maxItems = 40): JsonSchema => ({
  type: 'array',
  description,
  items,
  maxItems,
});

const strings = (description: string, maxItems = 25): JsonSchema =>
  arrayOf({ type: 'string' }, description, maxItems);

function obj(properties: Record<string, JsonSchema>, description?: string): JsonSchema {
  return {
    type: 'object',
    ...(description ? { description } : {}),
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

// --- shared shapes ----------------------------------------------------------

export const LABEL_VALUES = ['VERIFIED', 'ESTIMATE', 'NEEDS_VERIFICATION', 'HIGH_RISK'];
const SEVERITY = ['low', 'medium', 'high'];
const IMPORTANCE = ['low', 'medium', 'high'];
const LEVEL = ['low', 'medium', 'high'];
const DECISIONS = ['proceed', 'proceed_with_caution', 'more_research', 'do_not_proceed'];
const SOURCE_TYPES = ['official', 'news', 'research', 'company', 'social', 'other'];

const EVIDENCE = obj(
  {
    source_id: str('Source register id such as "S001". Use "" if this rests on reasoning, not a source.'),
    source_title: str('Title of the source, or "" when there is none.'),
    source_url: str('URL of the source, or "" when there is none. Never invent a URL.'),
    support: str('In one sentence, what this source actually shows that supports the claim.'),
  },
  'A single piece of support for a claim.',
);

const FINDING = obj(
  {
    finding_id: str('Stable id such as "F001". Later agents cite this to challenge the claim.'),
    claim: str('The claim itself, stated plainly in one or two sentences.'),
    category: str('Short topic label, e.g. "market", "demand", "regulation", "cost".'),
    importance: enumOf(IMPORTANCE, 'How much this claim matters to the decision.'),
    label: enumOf(
      LABEL_VALUES,
      'VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. ' +
        'NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.',
    ),
    evidence: arrayOf(EVIDENCE, 'Support for this claim. Empty array means unsupported — label it accordingly.', 10),
    confidence: confidence('0 to 1. Be honest: an unsourced claim cannot be above 0.6.'),
  },
  'One claim, with its support and its honesty label.',
);

const ISSUE = obj(
  {
    issue_id: str('Stable id such as "I001".'),
    target_agent: str('Agent id whose work this challenges, e.g. "research". Use "" for your own caveat.'),
    target_finding_id: str('Finding id being challenged, e.g. "F002". Use "" if this is general.'),
    problem: str('What is wrong, missing, outdated or unsupported.'),
    severity: enumOf(SEVERITY, 'high means the mission should not proceed until this is resolved.'),
    required_action: str('What specifically must be done to resolve it.'),
  },
  'A problem found in an earlier agent’s work, or a limitation of your own.',
);

const RECOMMENDATION = obj(
  {
    priority: int('1 is the most important.', 1),
    action: str('A concrete action a person could start tomorrow.'),
    reason: str('Why this action, and why now.'),
  },
  'A prioritised recommendation.',
);

const SOURCE = obj(
  {
    source_id: str('Stable id such as "S001".'),
    title: str('Title of the page or document.'),
    url: str('The URL you actually retrieved. Never invent one.'),
    source_type: enumOf(SOURCE_TYPES, 'What kind of source this is.'),
    reliability: enumOf(['high', 'medium', 'low'], 'How much weight this source deserves.'),
  },
  'A source you actually consulted.',
);

/** The fields every agent must return (§22). */
function coreProperties(agentId: string): Record<string, JsonSchema> {
  return {
    mission_id: str('Echo the mission_id you were given, unchanged.'),
    agent: str(`Always the literal string "${agentId}".`),
    status: enumOf(
      ['completed', 'corrected', 'failed'],
      'Use "corrected" only when responding to a correction request. Use "failed" if you genuinely could not do the work.',
    ),
    findings: arrayOf(FINDING, 'Your own findings for this mission.', 30),
    evidence: arrayOf(EVIDENCE, 'Evidence you relied on that is not already attached to a finding.', 20),
    issues: arrayOf(
      ISSUE,
      'Problems you found in earlier agents’ work, plus honest limitations of your own. ' +
        'Challenging the previous agent is part of your job, not an optional extra.',
      20,
    ),
    assumptions: strings('Every assumption you made. State them; never let one pass as a fact.'),
    recommendations: arrayOf(RECOMMENDATION, 'What you recommend, in priority order.', 15),
    next_agent_instructions: str('What the next agent most needs to check, verify or build on.'),
    confidence: confidence('Your overall confidence in this output, 0 to 1.'),
  };
}

function agentSchema(agentId: string, extra: Record<string, JsonSchema>): JsonSchema {
  return obj({ ...coreProperties(agentId), ...extra });
}

// --- per-agent schemas ------------------------------------------------------

export const TASK_MANAGER_SCHEMA = agentSchema('task_manager', {
  task_definition: obj({
    objective: str('What the user is actually trying to achieve, in one sentence.'),
    problem_to_solve: str('The underlying problem behind the request.'),
    success_criteria: strings('How we will know the mission answered the question.'),
    constraints: strings('Budget, geography, timing, legal or other limits that apply.'),
  }),
  research_questions: arrayOf(
    obj({
      question_id: str('Stable id such as "Q001".'),
      question: str('A specific, answerable question.'),
      priority: enumOf(IMPORTANCE, 'How much the answer matters.'),
    }),
    'The questions the island must answer to complete this mission.',
    20,
  ),
  required_agents: arrayOf(
    obj({
      agent_id: str('Agent id from the roster you were given.'),
      reason: str('Why this agent is needed for this particular task.'),
      required: { type: 'boolean', description: 'False means nice-to-have.' },
    }),
    'Which agents this mission needs. Only ids from the roster you were given.',
    20,
  ),
  execution_order: strings('Agent ids in the order they should run.', 20),
  deliverables: strings('What the user should have in hand when the mission ends.'),
});

export const RESEARCH_SCHEMA = agentSchema('research', {
  statistics: arrayOf(
    obj({
      metric: str('What is being measured.'),
      value: str('The value, with its unit and the year it refers to.'),
      source_id: str('Which source this came from, e.g. "S001". Use "" if unsourced.'),
    }),
    'Numbers that matter, each tied to where it came from.',
    20,
  ),
  sources: arrayOf(SOURCE, 'Every source you actually retrieved. Never list a source you did not read.', 30),
  information_gaps: strings('What you could not find out, and why it matters.'),
});

export const COMPETITOR_SCHEMA = agentSchema('competitor', {
  competitors: arrayOf(
    obj({
      competitor_id: str('Stable id such as "C001".'),
      name: str('The business name.'),
      location: str('Where it operates.'),
      website: str('URL or social handle. "" if you could not find one.'),
      offering: str('What it actually sells.'),
      target_customer: str('Who it sells to.'),
      pricing: str('What it charges, with the currency, or "unknown".'),
      strengths: strings('What it does well.', 8),
      weaknesses: strings('Where it is weak or under-serving customers.', 8),
      source_ids: strings('Source ids backing this entry.', 8),
    }),
    'Competitors you found. An empty list is a finding in itself — say so in findings.',
    20,
  ),
  market_gaps: arrayOf(
    obj({
      gap_id: str('Stable id such as "G001".'),
      description: str('The gap, stated as an unmet customer need.'),
      evidence: strings('What makes you think this gap is real.', 8),
      confidence: confidence('How sure you are the gap exists.'),
    }),
    'Gaps in the competitive landscape.',
    15,
  ),
  previous_claims_challenged: arrayOf(
    obj({
      finding_id: str('The earlier finding id you are challenging.'),
      original_claim: str('The claim as the earlier agent stated it.'),
      challenge: str('What is wrong or incomplete about it, and how you know.'),
      corrected_claim: str('The claim as it should read.'),
      severity: enumOf(SEVERITY, 'How badly the original claim would mislead.'),
    }),
    'Earlier claims you are correcting. "There are no competitors" is the claim most often wrong.',
    15,
  ),
});

export const MARKET_ANALYSIS_SCHEMA = agentSchema('market_analysis', {
  market_assessment: obj({
    market_size: str('Size with its unit and basis, or "unknown" — never guess a number silently.'),
    growth_potential: enumOf(LEVEL, 'How fast this market is growing.'),
    demand_level: enumOf(LEVEL, 'How strong current demand is.'),
    competition_level: enumOf(LEVEL, 'How crowded the market is.'),
  }),
  customer_segments: arrayOf(
    obj({
      segment: str('Who they are.'),
      problem: str('The problem they have today.'),
      estimated_demand: enumOf(LEVEL, 'How much demand this segment represents.'),
      evidence: strings('What supports this, with source ids where you have them.', 8),
    }),
    'Who would actually buy, and why.',
    12,
  ),
  opportunities: arrayOf(
    obj({
      description: str('The opportunity.'),
      potential: enumOf(LEVEL, 'Upside if it works.'),
      reason: str('Why this opportunity exists now.'),
    }),
    'Where the upside is.',
    12,
  ),
  threats: strings('What could kill this, from the market side.'),
});

export const ANALYSIS_SCHEMA = agentSchema('analysis', {
  patterns: strings('Patterns across the research that are not obvious from any single finding.'),
  opportunities: strings('Where the real opportunity sits.'),
  weaknesses: strings('Where the case is weak.'),
  unsupported_assumptions: arrayOf(
    obj({
      assumption: str('The assumption being carried forward as if it were established.'),
      why_unsupported: str('What evidence is missing.'),
      impact_if_wrong: str('What breaks if this turns out false.'),
    }),
    'Assumptions earlier work is leaning on without support. Challenge them.',
    12,
  ),
  alternatives: arrayOf(
    obj({
      option: str('An alternative direction worth comparing.'),
      pros: strings('In its favour.', 6),
      cons: strings('Against it.', 6),
    }),
    'Alternatives the user should weigh.',
    8,
  ),
  key_insights: strings('The few things that actually change the decision.'),
  recommended_direction: str('Where the evidence points, and how strongly.'),
});

export const RISK_VERIFICATION_SCHEMA = agentSchema('risk_verification', {
  verification_summary: obj({
    total_claims_reviewed: int('How many claims you actually reviewed.'),
    verified: int('Claims properly supported by a real source.'),
    needs_verification: int('Claims a human must confirm.'),
    contradictions: int('Direct conflicts between agents.'),
    high_risk_items: int('Items that could sink the venture or the decision.'),
  }),
  verified_findings: strings('Finding ids that hold up.', 40),
  flagged_findings: arrayOf(
    obj({
      finding_id: str('The finding id you are flagging.'),
      agent: str('Agent id responsible for it.'),
      reason: str('Why it does not hold up.'),
      severity: enumOf(SEVERITY, 'high blocks the mission until it is resolved or recorded as unresolved.'),
      recommended_action: str('What must be done about it.'),
    }),
    'Findings that fail verification.',
    25,
  ),
  contradictions: arrayOf(
    obj({
      claim_a: str('One claim.'),
      claim_b: str('The claim it conflicts with.'),
      conflict: str('Why they cannot both be true.'),
      resolution: str('How to resolve it, or "" if it cannot be resolved yet.'),
    }),
    'Places where agents disagree.',
    15,
  ),
  required_research: strings('What still needs to be found out.'),
  overall_reliability: enumOf(['high', 'medium', 'low'], 'How much weight the body of work deserves.'),
  verification_passed: {
    type: 'boolean',
    description:
      'False if any high-severity flag or unresolved contradiction remains. ' +
      'Say false when it is false — the orchestrator will send the work back for correction.',
  },
});

export const FINANCIAL_SCHEMA = agentSchema('financial', {
  business_model: obj({
    revenue_streams: strings('How money would actually come in.', 10),
    pricing_model: str('How customers would be charged.'),
    target_customers: strings('Who pays.', 10),
  }),
  costs: arrayOf(
    obj({
      item: str('What is being paid for.'),
      amount: { type: 'number', description: 'Amount in the mission currency.', minimum: 0 },
      currency: str('Currency code, matching the mission currency.'),
      period: enumOf(['one_off', 'monthly', 'yearly'], 'How often this cost occurs.'),
      type: enumOf(['known', 'estimated'], 'Use "known" only for a figure you can cite.'),
      assumptions: strings('What this number assumes.', 8),
    }),
    'Cost lines. Every single one must be labelled known or estimated.',
    25,
  ),
  revenue_scenarios: arrayOf(
    obj({
      scenario: enumOf(['conservative', 'expected', 'optimistic'], 'Which case this is.'),
      monthly_revenue: { type: 'number', description: 'Monthly revenue in the mission currency.', minimum: 0 },
      monthly_cost: { type: 'number', description: 'Monthly cost in the mission currency.', minimum: 0 },
      monthly_profit: { type: 'number', description: 'Revenue minus cost. May be negative.' },
      assumptions: strings('What has to be true for this scenario.', 8),
    }),
    'Give all three cases. Never present a single number as the answer.',
    3,
  ),
  break_even: obj({
    estimated_months: int('Months to break even under the expected case.'),
    required_customers: int('Customers per month needed to break even.'),
    assumptions: strings('What the break-even maths assumes.', 8),
  }),
  financial_risks: strings('What would blow a hole in these numbers.'),
  estimate_notice: str(
    'One sentence restating that every figure here is an estimate unless explicitly labelled known.',
  ),
});

export const STRATEGY_SCHEMA = agentSchema('strategy', {
  recommendation: obj({
    decision: enumOf(DECISIONS, 'Your call, based on the verified work.'),
    reason: str('Why, in plain language, referencing the evidence.'),
  }),
  strategy: arrayOf(
    obj({
      priority: int('1 is first.', 1),
      action: str('What to do.'),
      reason: str('Why it comes at this point.'),
    }),
    'The strategy, in priority order.',
    12,
  ),
  implementation_plan: arrayOf(
    obj({
      phase: int('Phase number, starting at 1.', 1),
      name: str('Short phase name.'),
      objective: str('What this phase is for.'),
      actions: strings('Concrete steps inside this phase.', 8),
      success_metric: str('The measurable signal that this phase worked.'),
    }),
    'A phased plan a real team could follow.',
    8,
  ),
  key_risks: strings('The risks that matter to execution.'),
  stop_conditions: strings('The signals that should make the user stop and walk away.'),
});

export const CHIEF_AI_SCHEMA = agentSchema('chief_ai', {
  executive_summary: str('The answer to the user’s question, in one short paragraph.'),
  key_findings: arrayOf(
    obj({
      finding: str('The finding, restated for a decision-maker.'),
      evidence: strings('Source ids or finding ids behind it.', 10),
      label: enumOf(LABEL_VALUES, 'How solid this is.'),
      confidence: confidence('Your own confidence, not the originating agent’s.'),
    }),
    'The findings that actually bear on the decision.',
    15,
  ),
  final_assessment: obj({
    decision: enumOf(DECISIONS, 'Your independent call. You may overrule the Strategy Agent.'),
    reason: str('Why. If you overruled an earlier agent, say so explicitly.'),
  }),
  financial_summary: obj({
    estimated_startup_cost: { type: 'number', description: 'Total one-off cost. 0 if not estimated.', minimum: 0 },
    estimated_monthly_cost: { type: 'number', description: 'Expected monthly cost. 0 if not estimated.', minimum: 0 },
    estimated_monthly_revenue: { type: 'number', description: 'Expected monthly revenue. 0 if not estimated.', minimum: 0 },
    currency: str('Currency code for the figures above.'),
    note: str('State plainly that these are estimates unless explicitly verified.'),
  }),
  contradictions_resolved: arrayOf(
    obj({
      conflict: str('The disagreement between agents.'),
      resolution: str('How you resolved it, and on what basis.'),
      rejected_claim: str('The claim you are rejecting, or "" if you kept both with caveats.'),
    }),
    'Disagreements you settled. Do not paper over them.',
    12,
  ),
  rejected_conclusions: arrayOf(
    obj({
      agent: str('Whose conclusion you are rejecting.'),
      conclusion: str('The conclusion.'),
      reason: str('Why it does not survive review.'),
    }),
    'Earlier conclusions you are throwing out. Accepting everything is a failure of this role.',
    12,
  ),
  major_risks: strings('The risks the user must know about.'),
  unknowns: strings('What remains genuinely unknown.'),
  action_plan: arrayOf(RECOMMENDATION, 'What the user should do next, in order.', 10),
  what_would_change_this: strings('Information that would change the recommendation if it turned up.'),
  overall_confidence: confidence('Confidence in the recommendation, 0 to 1.'),
  confidence_explanation: str('Explain plainly why this is not 100%.'),
  agent_summary: arrayOf(
    obj({
      agent: str('Agent id.'),
      status: str('How that agent’s work ended up: completed, corrected, failed or skipped.'),
      key_contribution: str('What it actually added — or that it added little.'),
    }),
    'One line per agent that ran.',
    20,
  ),
});

// --- Forex desk -------------------------------------------------------------
//
// These three exist because a currency question is not a market-research
// question: it turns on scheduled events, rate differentials and levels, and it
// is acted on with money in minutes rather than quarters. That raises the cost
// of a confident wrong answer, so their schemas force the reasoning and the
// invalidation into the open rather than letting a direction stand alone.

export const MARKET_CONTEXT_SCHEMA = agentSchema('market_context', {
  pair: str('The currency pair this concerns, e.g. "EUR/USD". "" if the task names none.'),
  regime: obj({
    description: str('What kind of market this has been lately, in one or two sentences.'),
    direction: enumOf(['uptrend', 'downtrend', 'range', 'unclear'], 'The prevailing structure.'),
    volatility: enumOf(LEVEL, 'How much it has been moving.'),
    confidence: confidence('How sure you are of this reading without live prices.'),
  }),
  drivers: arrayOf(
    obj({
      driver: str('The force acting on this pair, e.g. "policy rate differential".'),
      side: enumOf(['supports_base', 'supports_quote', 'unclear'], 'Which currency it favours.'),
      why: str('The mechanism, in plain language.'),
      source_id: str('Source id if you retrieved one, otherwise "".'),
    }),
    'What is actually moving this pair.',
    12,
  ),
  scheduled_events: arrayOf(
    obj({
      event: str('The release or decision, e.g. "FOMC rate decision".'),
      when: str('Date and time with a timezone, or "unknown" — never guess a date.'),
      importance: enumOf(IMPORTANCE, 'How much it typically moves this pair.'),
      source_id: str('Source id if you retrieved one, otherwise "".'),
    }),
    'Known events ahead. If you could not retrieve a calendar, return an empty list and say so in a finding.',
    12,
  ),
  data_available: {
    type: 'boolean',
    description:
      'False if you could not retrieve live prices or a calendar and are reasoning from training ' +
      'data alone. Answer honestly — the report states this to the user.',
  },
});

export const TECHNICAL_SCHEMA = agentSchema('technical_analysis', {
  pair: str('The currency pair this concerns.'),
  price_basis: obj({
    source: str('Where the prices came from, or "none — no price data was available".'),
    as_of: str('Timestamp of the data, or "unknown".'),
    live: { type: 'boolean', description: 'False when you had no live price feed.' },
  }),
  levels: arrayOf(
    obj({
      kind: enumOf(['support', 'resistance', 'pivot'], 'What kind of level this is.'),
      price: str('The level as a price string. "unknown" if you had no data — never invent one.'),
      basis: str('Why this level matters: what formed it.'),
      strength: enumOf(LEVEL, 'How well it has held.'),
    }),
    'Levels that matter. With no price feed this must be empty rather than guessed.',
    12,
  ),
  signals: arrayOf(
    obj({
      name: str('The observation, e.g. "lower highs since the April peak".'),
      reads: enumOf(['bullish', 'bearish', 'neutral'], 'Which way it points.'),
      timeframe: str('The timeframe it applies to, e.g. "daily".'),
      caveat: str('What would make this reading wrong.'),
    }),
    'What the structure suggests.',
    12,
  ),
  conflicts_with_context: strings('Where the technical read disagrees with the market context.'),
});

export const TRADE_THESIS_SCHEMA = agentSchema('trade_thesis', {
  pair: str('The currency pair.'),
  thesis: obj({
    direction: enumOf(
      ['long_base', 'short_base', 'stand_aside'],
      'Long the base currency, short it, or do nothing. "stand_aside" is a real answer and often the right one.',
    ),
    reasoning: str('Why, in plain language, naming the drivers it rests on.'),
    timeframe: str('Over what horizon this thesis is meant to play out.'),
    conviction: confidence('0 to 1. Without live prices this cannot honestly exceed 0.5.'),
  }),
  invalidation: obj({
    what_would_break_it: str('The specific development that would make this thesis wrong.'),
    level: str('The price level that would prove it wrong, or "unknown" with no price data.'),
    reasoning: str('Why that is the point at which the idea has failed.'),
  }),
  scenarios: arrayOf(
    obj({
      scenario: str('What happens.'),
      likelihood: enumOf(LEVEL, 'How likely, relative to the others.'),
      implication: str('What it would mean for the thesis.'),
    }),
    'The ways this could go, including the one where the thesis is wrong.',
    6,
  ),
  what_to_watch: strings('The specific things to check before and after acting.'),
  not_advice: str(
    'One sentence, in your own words, stating that this is analysis rather than financial advice ' +
    'and that the reader is responsible for their own position sizing and risk.',
  ),
});

/** Schema for optional specialists (§9). Deliberately generic so a new agent
 *  can be added with a prompt and a roster entry and nothing else. */
export const SPECIALIST_SCHEMA = (agentId: string): JsonSchema =>
  agentSchema(agentId, {
    domain_assessment: str('Your read on this mission from your speciality, in one paragraph.'),
    opportunities: strings('What your speciality says is possible here.'),
    concerns: strings('What your speciality says to worry about.'),
    required_checks: strings('What a human specialist should verify before committing.'),
  });

/** Returned by an agent on a correction round (§20.8). */
export const CORRECTION_SCHEMA = (agentId: string): JsonSchema =>
  obj({
    mission_id: str('Echo the mission_id unchanged.'),
    agent: str(`Always the literal string "${agentId}".`),
    status: enumOf(['corrected', 'failed'], 'Use "failed" only if the issue genuinely cannot be addressed.'),
    corrections: arrayOf(
      obj({
        finding_id: str('The finding you are correcting.'),
        previous_claim: str('What it said before.'),
        corrected_claim: str('What it says now. If nothing changed, repeat it and explain why in the reason.'),
        reason_for_change: str('Why it changed, or why it stands.'),
        new_sources: strings('Source ids of anything new you found.', 10),
        resolved: { type: 'boolean', description: 'False if you could not resolve it — say so rather than pretend.' },
      }),
      'One entry per issue you were asked to fix.',
      20,
    ),
    findings: arrayOf(FINDING, 'Any new or replacement findings.', 20),
    sources: arrayOf(SOURCE, 'Any new sources you retrieved.', 20),
    remaining_uncertainties: strings('What is still not settled.'),
    confidence: confidence('Your confidence after the correction.'),
  });

export const SCHEMAS_BY_AGENT: Record<string, JsonSchema> = {
  market_context: MARKET_CONTEXT_SCHEMA,
  technical_analysis: TECHNICAL_SCHEMA,
  trade_thesis: TRADE_THESIS_SCHEMA,
  task_manager: TASK_MANAGER_SCHEMA,
  research: RESEARCH_SCHEMA,
  competitor: COMPETITOR_SCHEMA,
  market_analysis: MARKET_ANALYSIS_SCHEMA,
  analysis: ANALYSIS_SCHEMA,
  risk_verification: RISK_VERIFICATION_SCHEMA,
  financial: FINANCIAL_SCHEMA,
  strategy: STRATEGY_SCHEMA,
  chief_ai: CHIEF_AI_SCHEMA,
};
