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
    finding: `${finding.claim} (${agent})`,
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

  const majorRisks = unique(
    chief
      ? textList(chief.major_risks)
      : [
          ...(strategy ? textList(strategy.key_risks) : []),
          ...(outputs.get('financial') ? textList(outputs.get('financial')?.financial_risks) : []),
          ...unresolvedIssues.filter((issue) => issue.severity === 'high').map((issue) => issue.problem),
        ],
  );

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

  return {
    mission_id: mission.id,
    mission_reference: mission.reference,
    generated_at: nowIso(),
    engine: mission.engine,
    original_task: mission.userTask,
    executive_summary: chief ? asText(chief.executive_summary) || missing('chief_ai') : missing('chief_ai'),
    key_findings: keyFindingsFrom(chief, outputs),
    research_summary: researchSummary(outputs.get('research')),
    competitor_summary: competitorSummary(outputs.get('competitor')),
    market_summary: marketSummary(outputs.get('market_analysis')),
    analysis_summary: analysisSummary(outputs.get('analysis')),
    financial_summary: financialSummaryFrom(chief, outputs.get('financial'), mission.currency),
    major_risks: majorRisks,
    verification: {
      total_claims_reviewed: Math.round(asNumber(verificationSummary.total_claims_reviewed, 0)),
      verified: Math.round(asNumber(verificationSummary.verified, 0)),
      needs_verification: Math.round(asNumber(verificationSummary.needs_verification, 0)),
      contradictions: Math.round(asNumber(verificationSummary.contradictions, 0)),
      high_risk_items: Math.round(asNumber(verificationSummary.high_risk_items, 0)),
      rounds_used: verificationRuns.length,
      passed: verifier?.verification_passed === true,
    },
    strategy_summary: strategySummary(strategy),
    recommendation,
    action_plan: actionPlanFrom(chief, strategy),
    assumptions,
    unresolved_questions: unresolvedQuestions,
    unresolved_issues: unresolvedIssues,
    corrections,
    sources,
    overall_confidence: chief ? asNumber(chief.overall_confidence, derivedConfidence) : derivedConfidence,
    confidence_explanation: chief
      ? asText(chief.confidence_explanation) ||
        'The chief_ai agent gave no explanation for its confidence figure.'
      : `${missing('chief_ai')} The figure above is the plain average of the confidence each agent ` +
        'reported in its own work, which is a weaker number than a reviewed one.',
    agent_summary: agentSummary,
    simulation_notice: mission.engine === 'simulation' ? SIMULATION_NOTICE : '',
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
