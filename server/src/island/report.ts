/**
 * The final report (§12), and the markdown a person actually reads.
 *
 * Everything here is assembled from what is already on record: the Chief AI's
 * own output where it ran, and the run rows, source register, verification
 * records and correction trail where it did not. Nothing in this file writes a
 * sentence the mission did not earn — a section whose agent never ran says so
 * in as many words, a figure nobody estimated stays zero with a note attached,
 * and an issue nobody resolved is printed as unresolved rather than dropped on
 * the way to a tidier document.
 */
import type { TenantStore } from '../db/tenant';
import { nowIso } from '../lib/time';
import { AGENTS, getAgent } from './agents/registry';
import { listCorrections, listSources, listVerifications } from './store';
import {
  DECISION_LABEL,
  LABEL_EMOJI,
  type AgentOutput,
  type AgentRunRecord,
  type CorrectionIssue,
  type Decision,
  type FinalReport,
  type Finding,
  type Label,
  type MissionRecord,
  type Recommendation,
  type ReportKeyFinding,
  type SourceRecord,
  type VerificationRecord,
} from './types';

const DECISIONS = new Set<string>(['proceed', 'proceed_with_caution', 'more_research', 'do_not_proceed']);
const LABELS = new Set<string>(['VERIFIED', 'ESTIMATE', 'NEEDS_VERIFICATION', 'HIGH_RISK']);

const SIMULATION_NOTICE =
  'No model ran on this mission. It went through the island end to end — the hand-offs, the ' +
  'challenges and the correction round are all real — but every figure, finding and summary below is ' +
  'placeholder structure, not research. Configure an API key and run the mission again before ' +
  'relying on any of it.';

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Ends a sentence around a value that may already have ended one itself. */
function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function textList(value: unknown): string[] {
  return asArray(value).map(asText).filter(Boolean);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

function money(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
}

function unique(values: string[], limit = 60): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

/** What a section says when the agent behind it never ran. */
function missing(agentId: string): string {
  return `No ${agentId.replace(/_/g, ' ')} agent ran on this mission.`;
}

function topClaims(output: AgentOutput, limit: number): string[] {
  return output.findings
    .filter((finding) => finding.importance === 'high')
    .slice(0, limit)
    .map((finding) => `${finding.claim} (${finding.label}, confidence ${percent(finding.confidence)})`);
}

// ---------------------------------------------------------------------------
// Section summaries, each built only from its own agent's output
// ---------------------------------------------------------------------------

function researchSummary(output: AgentOutput | undefined): string {
  if (!output) return missing('research');
  const statistics = asArray(output.statistics).length;
  const gaps = textList(output.information_gaps);
  const claims = topClaims(output, 3);

  const parts = [
    `The research agent recorded ${plural(output.findings.length, 'finding')} and ` +
      `${plural(statistics, 'statistic')}, at an overall confidence of ${percent(output.confidence)}.`,
  ];
  if (claims.length) parts.push(`Its highest-importance findings: ${claims.join(' ')}`);
  parts.push(
    gaps.length
      ? `It could not establish: ${gaps.join('; ')}.`
      : 'It reported no outstanding information gaps.',
  );
  return parts.join(' ');
}

function competitorSummary(output: AgentOutput | undefined): string {
  if (!output) return missing('competitor');
  const competitors = asArray(output.competitors).map(asRecord);
  const names = competitors.map((entry) => asText(entry.name)).filter(Boolean);
  const gaps = asArray(output.market_gaps).length;
  const challenged = asArray(output.previous_claims_challenged).length;

  if (competitors.length === 0) {
    return (
      'The competitor agent named no competitors. That is recorded as a finding in its own right, ' +
      'not as evidence of an empty market — an unsearchable market and an empty one look identical ' +
      'from here.'
    );
  }

  const listed = names.slice(0, 8).join(', ');
  return (
    `The competitor agent named ${plural(names.length, 'competitor')}` +
    `${listed ? ` — ${listed}${names.length > 8 ? ', among others' : ''}` : ''} and identified ` +
    `${plural(gaps, 'market gap')}. It challenged ${plural(challenged, 'earlier claim')}.`
  );
}

function marketSummary(output: AgentOutput | undefined): string {
  if (!output) return missing('market_analysis');
  const assessment = asRecord(output.market_assessment);
  const segments = asArray(output.customer_segments).length;
  const threats = textList(output.threats);

  const parts = [
    `Market size: ${sentence(asText(assessment.market_size) || 'not established')} Growth ` +
      `${asText(assessment.growth_potential) || 'unknown'}, demand ` +
      `${asText(assessment.demand_level) || 'unknown'}, competition ` +
      `${asText(assessment.competition_level) || 'unknown'}.`,
    `It described ${plural(segments, 'customer segment')}.`,
  ];
  if (threats.length) parts.push(`Threats it named: ${threats.slice(0, 5).join('; ')}.`);
  return parts.join(' ');
}

function analysisSummary(output: AgentOutput | undefined): string {
  if (!output) return missing('analysis');
  const direction = asText(output.recommended_direction);
  const insights = textList(output.key_insights);
  const unsupported = asArray(output.unsupported_assumptions).length;

  const parts: string[] = [];
  if (direction) parts.push(direction);
  if (insights.length) parts.push(`Key insights: ${insights.slice(0, 5).join('; ')}.`);
  parts.push(
    `It flagged ${plural(unsupported, 'assumption')} that earlier work was carrying as established.`,
  );
  return parts.join(' ');
}

function strategySummary(output: AgentOutput | undefined): string {
  if (!output) return missing('strategy');
  const recommendation = asRecord(output.recommendation);
  const actions = asArray(output.strategy)
    .map((raw) => asText(asRecord(raw).action))
    .filter(Boolean);
  const stops = textList(output.stop_conditions);

  const parts = [asText(recommendation.reason) || 'The strategy agent gave no reasoning for its call.'];
  if (actions.length) parts.push(`Its plan starts with: ${actions.slice(0, 4).join('; ')}.`);
  if (stops.length) parts.push(`It would stop if: ${stops.slice(0, 4).join('; ')}.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Pieces the Chief AI owns, with an honest fallback for when it did not run
// ---------------------------------------------------------------------------

function keyFindingsFrom(chief: AgentOutput | undefined, outputs: Map<string, AgentOutput>): ReportKeyFinding[] {
  if (chief) {
    const listed = asArray(chief.key_findings).map((raw) => {
      const entry = asRecord(raw);
      const label = asText(entry.label);
      return {
        finding: asText(entry.finding),
        evidence: textList(entry.evidence),
        label: (LABELS.has(label) ? label : 'NEEDS_VERIFICATION') as Label,
        confidence: asNumber(entry.confidence, 0),
      };
    });
    if (listed.length) return listed.filter((entry) => entry.finding);
  }

  // Nobody drew the headline findings together, so they are taken straight from
  // the agents that made them rather than invented here.
  const collected: { agent: string; finding: Finding }[] = [];
  for (const [agent, output] of outputs) {
    for (const finding of output.findings) {
      if (finding.importance === 'high') collected.push({ agent, finding });
    }
  }
  return collected.slice(0, 12).map(({ agent, finding }) => ({
    // Attributed by the name the agent is known by everywhere else. `agent` is a
    // database key and has no business closing a sentence a person reads.
    finding: `${finding.claim} (${getAgent(agent)?.name ?? agent})`,
    evidence: finding.evidence.map((item) => item.source_id).filter(Boolean),
    label: finding.label,
    confidence: finding.confidence,
  }));
}

function financialSummaryFrom(
  chief: AgentOutput | undefined,
  financial: AgentOutput | undefined,
  currency: string,
): FinalReport['financial_summary'] {
  if (chief) {
    const summary = asRecord(chief.financial_summary);
    return {
      estimated_startup_cost: asNumber(summary.estimated_startup_cost, 0),
      estimated_monthly_cost: asNumber(summary.estimated_monthly_cost, 0),
      estimated_monthly_revenue: asNumber(summary.estimated_monthly_revenue, 0),
      currency: asText(summary.currency) || currency,
      note: asText(summary.note) || 'Every figure here is an estimate unless it is explicitly labelled known.',
    };
  }

  if (!financial) {
    return {
      estimated_startup_cost: 0,
      estimated_monthly_cost: 0,
      estimated_monthly_revenue: 0,
      currency,
      note: `${missing('financial')} These zeros are the absence of an estimate, not an estimate of zero.`,
    };
  }

  const costs = asArray(financial.costs).map(asRecord);
  const startup = costs
    .filter((cost) => asText(cost.period) === 'one_off')
    .reduce((total, cost) => total + asNumber(cost.amount, 0), 0);
  const expected = asArray(financial.revenue_scenarios)
    .map(asRecord)
    .find((scenario) => asText(scenario.scenario) === 'expected');

  const monthlyFromCosts = costs
    .filter((cost) => asText(cost.period) === 'monthly')
    .reduce((total, cost) => total + asNumber(cost.amount, 0), 0);

  return {
    estimated_startup_cost: startup,
    estimated_monthly_cost: asNumber(expected?.monthly_cost, monthlyFromCosts),
    estimated_monthly_revenue: asNumber(expected?.monthly_revenue, 0),
    currency,
    note:
      asText(financial.estimate_notice) ||
      'Taken from the financial agent’s expected case. Every figure is an estimate unless labelled known.',
  };
}

function recommendationFrom(
  chief: AgentOutput | undefined,
  strategy: AgentOutput | undefined,
): { decision: Decision; reason: string } {
  const chiefCall = asRecord(chief?.final_assessment);
  const chiefDecision = asText(chiefCall.decision);
  if (DECISIONS.has(chiefDecision)) {
    return { decision: chiefDecision as Decision, reason: asText(chiefCall.reason) };
  }

  const strategyCall = asRecord(strategy?.recommendation);
  const strategyDecision = asText(strategyCall.decision);
  if (DECISIONS.has(strategyDecision)) {
    return {
      decision: strategyDecision as Decision,
      reason:
        `${missing('chief_ai')} This is the strategy agent's call, which nobody reviewed independently. ` +
        asText(strategyCall.reason),
    };
  }

  return {
    decision: 'more_research',
    reason:
      'Neither the chief_ai agent nor the strategy agent produced a decision on this mission, so the ' +
      'island has no recommendation to give. What is below is the work that did complete.',
  };
}

function actionPlanFrom(chief: AgentOutput | undefined, strategy: AgentOutput | undefined): Recommendation[] {
  const source = chief ? asArray(chief.action_plan) : asArray(strategy?.strategy);
  return source
    .map((raw) => {
      const entry = asRecord(raw);
      return {
        priority: Math.max(1, Math.round(asNumber(entry.priority, 1))),
        action: asText(entry.action),
        reason: asText(entry.reason),
      };
    })
    .filter((entry) => entry.action)
    .sort((a, b) => a.priority - b.priority);
}

// ---------------------------------------------------------------------------
// Reconciliation (§8, §21.6) — the record outranks what an agent said about it
// ---------------------------------------------------------------------------

/**
 * Everything below exists because of one asymmetry: an agent's output is a
 * claim, and the database is a record. For most of this file the two agree and
 * the distinction does not matter. Where they disagree, the record wins — and
 * the disagreement is written into `integrity_notes` rather than resolved
 * quietly, because a silent correction asks the reader to trust the assembler
 * instead of the agent, which is the same bargain in a different coat.
 *
 * What made this necessary: the labels, the tallies and the headline confidence
 * were all taken verbatim from the models that produced them. The rules they
 * were supposed to follow existed only as sentences in their prompts, so a
 * claim could be printed 🟢 VERIFIED at 95% citing "S001" in a report whose own
 * source register was empty, and nothing in the system objected.
 */

/** A citation only counts if it names a source the mission actually registered. */
function knownSourceIds(sources: SourceRecord[]): Set<string> {
  return new Set(sources.map((source) => source.source_id).filter(Boolean));
}

/**
 * Holds every headline finding to the evidence the mission actually has.
 *
 * A citation to an id that is in no register is dropped: it refers to nothing,
 * and printing it lends a claim the look of support it does not have. A finding
 * left with no surviving citation cannot be VERIFIED, whatever the model typed
 * — VERIFIED means "a real source says this, and here it is", and there is now
 * demonstrably no here.
 */
function reconcileKeyFindings(
  findings: ReportKeyFinding[],
  sources: SourceRecord[],
  notes: string[],
): ReportKeyFinding[] {
  const known = knownSourceIds(sources);
  return findings.map((finding) => {
    const cited = finding.evidence.filter(Boolean);
    const real = cited.filter((id) => known.has(id));
    const invented = cited.filter((id) => !known.has(id));

    if (invented.length > 0) {
      notes.push(
        `"${truncate(finding.finding)}" cited ${invented.join(', ')}, which ${
          invented.length === 1 ? 'is not a source' : 'are not sources'
        } this mission registered. ${
          invented.length === 1 ? 'It has' : 'They have'
        } been dropped from the citation.`,
      );
    }

    let label = finding.label;
    if (label === 'VERIFIED' && real.length === 0) {
      label = 'NEEDS_VERIFICATION';
      notes.push(
        `"${truncate(finding.finding)}" was labelled VERIFIED with nothing cited that this mission ` +
          'holds a source for, so it is shown as NEEDS_VERIFICATION.',
      );
    }

    return { ...finding, evidence: real, label };
  });
}

/**
 * The verification tallies, counted from the verification rows.
 *
 * These were previously the verification agent's own summary of its own work —
 * a number it typed about itself, printed as the mission's audit. The rows are
 * what it actually filed, so a mission can no longer report "High-risk items: 0"
 * over a stored, unresolved high-risk flag.
 */
function verificationFromRecord(
  verifications: VerificationRecord[],
  claimed: Record<string, unknown>,
  notes: string[],
): { total: number; verified: number; needsVerification: number; contradictions: number; highRisk: number } {
  const counted = {
    total: verifications.length,
    verified: verifications.filter((record) => record.status === 'verified').length,
    needsVerification: verifications.filter((record) => record.status === 'needs_verification').length,
    contradictions: verifications.filter((record) => record.status === 'contradiction').length,
    highRisk: verifications.filter((record) => record.status === 'high_risk' || record.severity === 'high')
      .length,
  };

  // Only worth saying when the verifier's account of itself differs from what it
  // filed. Agreement is the normal case and needs no note.
  const stated: [string, number, number][] = [
    ['claims reviewed', asNumber(claimed.total_claims_reviewed, counted.total), counted.total],
    ['verified', asNumber(claimed.verified, counted.verified), counted.verified],
    ['high-risk items', asNumber(claimed.high_risk_items, counted.highRisk), counted.highRisk],
    ['contradictions', asNumber(claimed.contradictions, counted.contradictions), counted.contradictions],
  ];
  for (const [name, said, actual] of stated) {
    if (Math.round(said) !== actual) {
      notes.push(
        `The verification agent reported ${Math.round(said)} ${name}; the verification record holds ` +
          `${actual}. The figure shown is the one from the record.`,
      );
    }
  }
  return counted;
}

/**
 * Caps the headline confidence at what the mission can support.
 *
 * The Chief AI's `overall_confidence` was printed exactly as typed, with nothing
 * between the model's JSON and the top of the report — so a mission whose every
 * agent reported 0.2, whose gate did not pass and whose source register was
 * empty could still open with a bold 99%.
 *
 * Two ceilings, both derived from the record: a mission that sourced nothing
 * cannot be highly confident, and no summary can be more certain than the most
 * certain thing it is summarising.
 */
const UNSOURCED_CEILING = 0.6;

function reconcileConfidence(
  stated: number,
  findings: ReportKeyFinding[],
  sources: SourceRecord[],
  gatePassed: boolean,
  notes: string[],
): number {
  let ceiling = 1;
  let because = '';

  const best = findings.length ? Math.max(...findings.map((finding) => finding.confidence)) : 1;
  if (findings.length && best < ceiling) {
    ceiling = best;
    because = 'no finding it rests on is held that confidently';
  }

  if (sources.length === 0 && UNSOURCED_CEILING < ceiling) {
    ceiling = UNSOURCED_CEILING;
    because = 'this mission registered no sources at all';
  }

  if (!gatePassed && UNSOURCED_CEILING < ceiling) {
    ceiling = UNSOURCED_CEILING;
    because = 'the verification gate did not pass';
  }

  if (stated <= ceiling) return stated;
  notes.push(
    `The overall confidence was given as ${percent(stated)}, but ${because}, so it is shown as ` +
      `${percent(ceiling)}.`,
  );
  return ceiling;
}

/** Long claims read badly inside a note about them. */
function truncate(value: string, limit = 80): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export function buildFinalReport(
  store: TenantStore,
  mission: MissionRecord,
  runs: AgentRunRecord[],
): FinalReport {
  const latest = new Map<string, AgentRunRecord>();
  for (const run of runs) {
    const current = latest.get(run.agentId);
    if (!current || run.status === 'completed' || current.status !== 'completed') {
      latest.set(run.agentId, run);
    }
  }

  const outputs = new Map<string, AgentOutput>();
  for (const [agentId, run] of latest) {
    if (run.status === 'completed' && run.output) outputs.set(agentId, run.output);
  }

  const chief = outputs.get('chief_ai');
  const strategy = outputs.get('strategy');
  const verifier = outputs.get('risk_verification');

  const verifications = listVerifications(store, mission.id);
  const corrections = listCorrections(store, mission.id);
  const sources = listSources(store, mission.id);

  // Filled in by the reconciliation below and printed in the report itself.
  const integrityNotes: string[] = [];

  const verificationRuns = runs.filter(
    (run) => run.agentId === 'risk_verification' && run.status === 'completed',
  );
  const verificationSummary = asRecord(verifier?.verification_summary);

  const unresolvedIssues: CorrectionIssue[] = verifications
    .filter((record) => !record.resolved && record.status !== 'verified')
    .map((record) => ({
      issue_id: record.id,
      agent: record.agentId,
      finding_id: record.findingId,
      problem: record.reason,
      severity: record.severity,
      required_action: record.recommendedAction,
    }));

  const assumptions = unique([...outputs.values()].flatMap((output) => output.assumptions));

  const unresolvedQuestions = unique([
    ...(chief ? textList(chief.unknowns) : []),
    ...(verifier ? textList(verifier.required_research) : []),
    ...(chief ? [] : [`${missing('chief_ai')} Nothing in this report was reviewed independently.`]),
    ...(verifier ? [] : [`${missing('risk_verification')} No claim here has been checked by anyone.`]),
  ]);

  // The chief's list AND what the agents actually filed. Taking only the
  // chief's meant a chief that returned an empty list printed "No agent named a
  // major risk" over the strategy and financial agents' risk lists, which were
  // sitting in the database the whole time. A risk an agent raised is a risk the
  // mission found, whether or not the summariser carried it forward.
  const agentRisks = [
    ...(strategy ? textList(strategy.key_risks) : []),
    ...(outputs.get('financial') ? textList(outputs.get('financial')?.financial_risks) : []),
    ...unresolvedIssues.filter((issue) => issue.severity === 'high').map((issue) => issue.problem),
  ];
  const chiefRisks = chief ? textList(chief.major_risks) : [];
  const majorRisks = unique([...chiefRisks, ...agentRisks]);
  const droppedByChief = agentRisks.filter((risk) => !chiefRisks.includes(risk));
  if (chief && droppedByChief.length > 0) {
    integrityNotes.push(
      `The chief's summary left out ${plural(droppedByChief.length, 'risk')} that ` +
        `${droppedByChief.length === 1 ? 'was' : 'were'} raised by another agent. ` +
        `${droppedByChief.length === 1 ? 'It is' : 'They are'} listed above alongside its own.`,
    );
  }

  const completed = [...outputs.values()];
  const derivedConfidence = completed.length
    ? completed.reduce((total, output) => total + output.confidence, 0) / completed.length
    : 0;

  const agentSummaryFromChief = new Map<string, string>();
  for (const raw of asArray(chief?.agent_summary)) {
    const entry = asRecord(raw);
    const agent = asText(entry.agent);
    if (agent) agentSummaryFromChief.set(agent, asText(entry.key_contribution));
  }

  const involved = AGENTS.map((agent) => agent.id).filter(
    (id) => latest.has(id) || mission.enabledAgents.includes(id),
  );
  for (const id of latest.keys()) {
    if (!involved.includes(id)) involved.push(id);
  }

  const agentSummary = involved.map((agentId) => {
    const run = latest.get(agentId);
    const output = outputs.get(agentId);
    const fromChief = agentSummaryFromChief.get(agentId);
    let contribution = fromChief ?? '';
    if (!contribution) {
      if (!run) contribution = 'Enabled for this mission but never ran.';
      else if (run.status !== 'completed') contribution = run.error ?? 'Did not finish.';
      else if (output) {
        contribution =
          `${plural(output.findings.length, 'finding')}, ${plural(output.issues.length, 'issue')} ` +
          `raised, confidence ${percent(output.confidence)}.`;
      }
    }
    return {
      agent: agentId,
      name: getAgent(agentId)?.name ?? agentId,
      status: run ? run.status : 'skipped',
      key_contribution: contribution,
    };
  });

  const recommendation = recommendationFrom(chief, strategy);

  // --- reconciliation ------------------------------------------------------
  // Everything above this line is what the mission said about itself. These
  // four lines are where the record gets to answer back.
  const gatePassed = verifier?.verification_passed === true;
  const counted = verificationFromRecord(verifications, verificationSummary, integrityNotes);
  const reconciledFindings = reconcileKeyFindings(keyFindingsFrom(chief, outputs), sources, integrityNotes);
  const reconciledConfidence = reconcileConfidence(
    chief ? asNumber(chief.overall_confidence, derivedConfidence) : derivedConfidence,
    reconciledFindings,
    sources,
    gatePassed,
    integrityNotes,
  );

  // The gate cannot report itself as passed while its own record still holds
  // unresolved flags. It said so about itself; the rows say otherwise.
  if (gatePassed && unresolvedIssues.length > 0) {
    integrityNotes.push(
      `The verification agent reported the gate as passed, but ${plural(unresolvedIssues.length, 'issue')} ` +
        `${unresolvedIssues.length === 1 ? 'is' : 'are'} still unresolved in the verification record. ` +
        'They are listed under unresolved issues below.',
    );
  }

  return {
    mission_id: mission.id,
    mission_reference: mission.reference,
    generated_at: nowIso(),
    engine: mission.engine,
    original_task: mission.userTask,
    executive_summary: chief ? asText(chief.executive_summary) || missing('chief_ai') : missing('chief_ai'),
    key_findings: reconciledFindings,
    research_summary: researchSummary(outputs.get('research')),
    competitor_summary: competitorSummary(outputs.get('competitor')),
    market_summary: marketSummary(outputs.get('market_analysis')),
    analysis_summary: analysisSummary(outputs.get('analysis')),
    financial_summary: financialSummaryFrom(chief, outputs.get('financial'), mission.currency),
    major_risks: majorRisks,
    verification: {
      total_claims_reviewed: counted.total,
      verified: counted.verified,
      needs_verification: counted.needsVerification,
      contradictions: counted.contradictions,
      high_risk_items: counted.highRisk,
      rounds_used: verificationRuns.length,
      passed: gatePassed,
    },
    strategy_summary: strategySummary(strategy),
    recommendation,
    action_plan: actionPlanFrom(chief, strategy),
    assumptions,
    unresolved_questions: unresolvedQuestions,
    unresolved_issues: unresolvedIssues,
    corrections,
    sources,
    overall_confidence: reconciledConfidence,
    confidence_explanation: chief
      ? asText(chief.confidence_explanation) ||
        'The chief_ai agent gave no explanation for its confidence figure.'
      : `${missing('chief_ai')} The figure above is the plain average of the confidence each agent ` +
        'reported in its own work, which is a weaker number than a reviewed one.',
    agent_summary: agentSummary,
    simulation_notice: mission.engine === 'simulation' ? SIMULATION_NOTICE : '',
    integrity_notes: integrityNotes,
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function bullets(items: string[], empty: string): string {
  if (items.length === 0) return `_${empty}_`;
  return items.map((item) => `- ${item}`).join('\n');
}

export function reportToMarkdown(report: FinalReport): string {
  const blocks: string[] = [];

  blocks.push(`# ${report.mission_reference} — mission report`);
  blocks.push(
    [
      `**Task:** ${report.original_task}`,
      `**Generated:** ${report.generated_at}`,
      `**Engine:** ${report.engine}`,
    ].join('  \n'),
  );

  if (report.simulation_notice) {
    blocks.push(`> ⚠️ **${report.simulation_notice}**`);
  }

  blocks.push(
    [
      '## Recommendation',
      '',
      `### ${DECISION_LABEL[report.recommendation.decision]}`,
      '',
      report.recommendation.reason || '_No reason was given._',
    ].join('\n'),
  );

  blocks.push(
    [
      '## Confidence',
      '',
      `**${percent(report.overall_confidence)}**`,
      '',
      report.confidence_explanation,
    ].join('\n'),
  );

  // Directly under the headline number, because that is the figure most likely
  // to have been corrected and the worst one to correct quietly. A reader who
  // sees 60% is entitled to know it was typed as 99%.
  if (report.integrity_notes.length) {
    blocks.push(
      [
        '## What this report had to correct',
        '',
        'Assembly checks what each agent claimed against what the mission actually recorded. Where the',
        'two disagreed, the record was used and the disagreement is listed here rather than settled out',
        'of sight.',
        '',
        report.integrity_notes.map((note) => `- ${note}`).join('\n'),
      ].join('\n'),
    );
  }

  blocks.push(`## Executive summary\n\n${report.executive_summary}`);

  blocks.push(
    [
      '## Key findings',
      '',
      report.key_findings.length
        ? report.key_findings
            .map(
              (finding) =>
                `- ${LABEL_EMOJI[finding.label]} **${finding.label}** · confidence ` +
                `${percent(finding.confidence)} — ${finding.finding}` +
                (finding.evidence.length ? `  \n  _Evidence:_ ${finding.evidence.join(', ')}` : ''),
            )
            .join('\n')
        : '_No agent produced a key finding for this mission._',
    ].join('\n'),
  );

  blocks.push(`## Research\n\n${report.research_summary}`);
  blocks.push(`## Competitors\n\n${report.competitor_summary}`);
  blocks.push(`## Market\n\n${report.market_summary}`);
  blocks.push(`## Analysis\n\n${report.analysis_summary}`);

  const finance = report.financial_summary;
  blocks.push(
    [
      '## Financials',
      '',
      '| Figure | Amount |',
      '| --- | --- |',
      `| Estimated startup cost | ${money(finance.estimated_startup_cost, finance.currency)} |`,
      `| Estimated monthly cost | ${money(finance.estimated_monthly_cost, finance.currency)} |`,
      `| Estimated monthly revenue | ${money(finance.estimated_monthly_revenue, finance.currency)} |`,
      '',
      finance.note,
    ].join('\n'),
  );

  const check = report.verification;
  blocks.push(
    [
      '## Verification',
      '',
      `**Gate ${check.passed ? 'passed' : 'did not pass'}** after ${plural(check.rounds_used, 'round')}.`,
      '',
      `- Claims reviewed: ${check.total_claims_reviewed}`,
      `- Verified: ${check.verified}`,
      `- Needing human verification: ${check.needs_verification}`,
      `- Contradictions: ${check.contradictions}`,
      `- High-risk items: ${check.high_risk_items}`,
    ].join('\n'),
  );

  blocks.push(`## Major risks\n\n${bullets(report.major_risks, 'No agent named a major risk.')}`);

  blocks.push(`## Strategy\n\n${report.strategy_summary}`);

  blocks.push(
    [
      '## Action plan',
      '',
      report.action_plan.length
        ? report.action_plan
            .map((entry) => `${entry.priority}. **${entry.action}** — ${entry.reason}`)
            .join('\n')
        : '_No agent produced an action plan for this mission._',
    ].join('\n'),
  );

  blocks.push(
    `## Assumptions\n\n${bullets(report.assumptions, 'No agent recorded an assumption, which is itself worth questioning.')}`,
  );

  blocks.push(
    `## Unresolved questions\n\n${bullets(report.unresolved_questions, 'Nothing was left open.')}`,
  );

  blocks.push(
    [
      '## Unresolved issues',
      '',
      report.unresolved_issues.length
        ? report.unresolved_issues
            .map(
              (issue) =>
                `- **${issue.severity}** · ${issue.agent || 'unattributed'}` +
                `${issue.finding_id ? ` · ${issue.finding_id}` : ''} — ${issue.problem}` +
                (issue.required_action ? `  \n  _Required:_ ${issue.required_action}` : ''),
            )
            .join('\n')
        : '_Every issue raised on this mission was resolved._',
    ].join('\n'),
  );

  blocks.push(
    [
      '## Corrections',
      '',
      report.corrections.length
        ? report.corrections
            .map(
              (correction) =>
                `- Round ${correction.round} · ${correction.fromAgent} → ${correction.toAgent}` +
                `${correction.findingId ? ` · ${correction.findingId}` : ''} · ` +
                `${correction.resolved ? 'resolved' : 'unresolved'}  \n` +
                `  _Before:_ ${correction.originalClaim || '(not recorded)'}  \n` +
                `  _After:_ ${correction.correctedClaim || '(unchanged)'}  \n` +
                `  _Why:_ ${correction.reason}`,
            )
            .join('\n')
        : '_No agent challenged or corrected another on this mission._',
    ].join('\n'),
  );

  blocks.push(
    [
      '## Source register',
      '',
      report.sources.length
        ? report.sources
            .map(
              (source) =>
                `- **${source.source_id}** · ${source.source_type} · reliability ` +
                `${source.reliability} — ${source.title || source.url}` +
                (source.url ? ` — <${source.url}>` : ''),
            )
            .join('\n')
        : '_No source was retrieved on this mission. Nothing here is sourced._',
    ].join('\n'),
  );

  blocks.push(
    [
      '## Agent appendix',
      '',
      '| Agent | Status | Contribution |',
      '| --- | --- | --- |',
      ...report.agent_summary.map(
        (entry) =>
          `| ${entry.name} (\`${entry.agent}\`) | ${entry.status} | ` +
          `${entry.key_contribution.replace(/\|/g, '\\|').replace(/\n+/g, ' ')} |`,
      ),
    ].join('\n'),
  );

  return `${blocks.join('\n\n')}\n`;
}
