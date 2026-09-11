/**
 * The engine behind the island.
 *
 * A mission runs inside this process, fire and forget: `startMission` returns
 * as soon as the work is handed to the loop below, and everything after that is
 * watched through `island_events`. That has one consequence this whole file is
 * shaped around — if the loop ever drops a mission without writing a terminal
 * status, the UI animates a mission that nothing is working on, for ever. So
 * every path out of `runMission` ends in completed, failed or aborted, and each
 * of them says why in an event.
 *
 * Three rules here cost the most to get right and are the easiest to fake, so
 * they are implemented literally: the verification gate genuinely sends work
 * back to the agent that made the claim and merges what comes back; a later
 * agent may not raise the confidence on someone else's finding without
 * attaching new evidence; and an agent that failed is never reported as
 * anything else.
 */
import type { TenantStore } from '../db/tenant';
import { conflict } from '../lib/errors';
import { nowIso } from '../lib/time';
import { getAgent, planWaves, requireAgent } from './agents/registry';
import { islandConfig } from './config';
import { getProvider } from './provider';
import { buildFinalReport } from './report';
import { CORRECTION_SCHEMA } from './schemas';
import {
  appendEvent,
  finishRun,
  getMission,
  listRuns,
  listSources,
  recordCorrection,
  recordSources,
  recordVerifications,
  resolveVerification,
  startRun,
  updateMission,
} from './store';
import {
  AgentFailure,
  STAGE_LABEL,
  STAGE_ORDER,
  type AgentDefinition,
  type AgentOutput,
  type AgentProvider,
  type CorrectionIssue,
  type CorrectionRequest,
  type Evidence,
  type Finding,
  type Handoff,
  type Importance,
  type Label,
  type MissionEnvelope,
  type MissionEventType,
  type MissionRecord,
  type MissionStatus,
  type Reliability,
  type ResearchQuestion,
  type Severity,
  type SourceRecord,
  type SourceType,
  type Stage,
  type VerificationRecord,
} from './types';
import { normaliseAndValidate } from './validate';

// ---------------------------------------------------------------------------
// Live missions
// ---------------------------------------------------------------------------

interface ActiveMission {
  /** One controller per mission; its signal reaches the provider, so an abort
   *  stops an agent mid-call rather than after it. */
  controller: AbortController;
  paused: boolean;
  resumeResolver: (() => void) | null;
  approvalResolver: (() => void) | null;
  /** Set when a control function has already written the terminal state, so the
   *  loop does not write a second one over the top of it. */
  settled: boolean;
}

const active = new Map<string, ActiveMission>();

const TERMINAL = new Set<MissionStatus>(['completed', 'failed', 'aborted']);

/** Dropped from the plan's narrowing however the Task Manager writes it: the
 *  gate and the final review are what make the rest of the mission trustworthy. */
const ALWAYS_KEEP = new Set(['risk_verification', 'chief_ai']);

/** Unwinds the mission loop. Not a failure — the user asked for it. */
class MissionAborted extends Error {
  constructor() {
    super('Mission aborted.');
    this.name = 'MissionAborted';
  }
}

export interface StartOptions {
  store: TenantStore;
  missionId: string;
}

export function isRunning(missionId: string): boolean {
  return active.has(missionId);
}

export function activeMissionCount(): number {
  return active.size;
}

// ---------------------------------------------------------------------------
// Reading model output: everything off the core envelope arrives as `unknown`
// ---------------------------------------------------------------------------

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

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const SEVERITIES = new Set<string>(['low', 'medium', 'high']);

function asSeverity(value: unknown, fallback: Severity = 'medium'): Severity {
  const text = asText(value);
  return SEVERITIES.has(text) ? (text as Severity) : fallback;
}

function asImportance(value: unknown, fallback: Importance = 'medium'): Importance {
  const text = asText(value);
  return SEVERITIES.has(text) ? (text as Importance) : fallback;
}

const SOURCE_TYPES = new Set<string>(['official', 'news', 'research', 'company', 'social', 'other']);

function toSource(raw: unknown): SourceRecord {
  const record = asRecord(raw);
  const type = asText(record.source_type);
  const reliability = asText(record.reliability);
  return {
    source_id: asText(record.source_id),
    title: asText(record.title),
    url: asText(record.url),
    source_type: SOURCE_TYPES.has(type) ? (type as SourceType) : 'other',
    reliability: SEVERITIES.has(reliability) ? (reliability as Reliability) : 'medium',
  };
}

/**
 * Best-effort match key for "these two citations are the same page".
 *
 * The store has its own, stricter normalisation when it assigns a register
 * ref; this one only has to line an agent's citation up with a ref that was
 * already assigned. A miss costs nothing — the citation keeps the id the agent
 * gave it — so it stays deliberately simple.
 */
function urlKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#]+$/, '');
}

function claimKey(claim: string): string {
  return claim.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

function evidenceKey(evidence: Evidence): string {
  const url = urlKey(evidence.source_url ?? '');
  if (url) return `url:${url}`;
  const id = asText(evidence.source_id).toLowerCase();
  return id ? `ref:${id}` : '';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function percent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Mission context — what the loop knows while it is running
// ---------------------------------------------------------------------------

/** Where a claim was first made, and on what evidence (§21 rule 6). */
interface FindingOrigin {
  agentId: string;
  confidence: number;
  claim: string;
  evidence: Set<string>;
}

/** What the Task Manager decided, reduced to the parts the loop acts on. */
interface MissionPlan {
  objective: string;
  constraints: string[];
  questions: ResearchQuestion[];
  agents: Set<string>;
  reasons: Map<string, string>;
}

interface MissionContext {
  store: TenantStore;
  mission: MissionRecord;
  handle: ActiveMission;
  provider: AgentProvider;
  /** Latest accepted output per agent. A backup agent's output is filed under
   *  the agent it stood in for as well as its own id. */
  outputs: Map<string, AgentOutput>;
  order: string[];
  sourcesByAgent: Map<string, SourceRecord[]>;
  origins: Map<string, FindingOrigin>;
  claimOrigins: Map<string, string>;
  plan: MissionPlan;
  failed: Set<string>;
  selected: string[];
}

function emit(
  ctx: MissionContext,
  type: MissionEventType,
  message: string,
  payload: Record<string, unknown> = {},
  agentId: string | null = null,
): void {
  appendEvent(ctx.store, ctx.mission.id, { type, agentId, message, payload });
}

// ---------------------------------------------------------------------------
// Pause, abort and the approval gate
// ---------------------------------------------------------------------------

function ensureLive(handle: ActiveMission): void {
  if (handle.controller.signal.aborted) throw new MissionAborted();
}

/** Resolves when the named resolver is called, or immediately on abort. */
function waitFor(handle: ActiveMission, slot: 'resumeResolver' | 'approvalResolver'): Promise<void> {
  return new Promise<void>((resolve) => {
    if (handle.controller.signal.aborted) {
      resolve();
      return;
    }
    const finish = (): void => {
      handle.controller.signal.removeEventListener('abort', finish);
      handle[slot] = null;
      resolve();
    };
    handle[slot] = finish;
    handle.controller.signal.addEventListener('abort', finish, { once: true });
  });
}

/** Checked before every agent: an abort stops the mission, a pause holds it. */
async function gate(handle: ActiveMission): Promise<void> {
  ensureLive(handle);
  while (handle.paused) {
    await waitFor(handle, 'resumeResolver');
    ensureLive(handle);
  }
}

async function awaitApproval(ctx: MissionContext, stage: Stage): Promise<void> {
  if (ctx.mission.mode !== 'approval') return;
  updateMission(ctx.store, ctx.mission.id, { status: 'awaiting_approval', pendingApprovalStage: stage });
  emit(
    ctx,
    'approval_required',
    `The ${STAGE_LABEL[stage]} stage is ready to start and is waiting for your approval.`,
    { stage },
  );
  await waitFor(ctx.handle, 'approvalResolver');
  ensureLive(ctx.handle);
}

// ---------------------------------------------------------------------------
// The envelope each agent is given (§3, §20.1, §23)
// ---------------------------------------------------------------------------

function importantFindings(output: AgentOutput, limit = 8): Finding[] {
  const ranked = [...output.findings].sort((a, b) => {
    const weight = (importance: Importance): number =>
      importance === 'high' ? 0 : importance === 'medium' ? 1 : 2;
    return weight(a.importance) - weight(b.importance);
  });
  return ranked.slice(0, limit);
}

function buildHandoff(ctx: MissionContext, fromId: string, to: AgentDefinition): Handoff | null {
  const output = ctx.outputs.get(fromId);
  if (!output) return null;
  const definition = getAgent(fromId);

  const completedWork = [
    `${definition?.role ?? fromId}: ${plural(output.findings.length, 'finding')}, ` +
      `${plural(output.issues.length, 'issue')} raised, overall confidence ${percent(output.confidence)}.`,
    ...output.recommendations.slice(0, 3).map((entry) => entry.action),
  ];

  const questions = [
    asText(output.next_agent_instructions),
    ...output.issues.filter((issue) => issue.target_agent === to.id).map((issue) => issue.required_action),
  ].filter(Boolean);

  return {
    from_agent: fromId,
    to_agent: to.id,
    mission_id: ctx.mission.id,
    completed_work: completedWork.filter(Boolean),
    important_findings: importantFindings(output),
    questions_to_check: questions,
    warnings: output.issues.filter((issue) => issue.severity === 'high').map((issue) => issue.problem),
    sources: ctx.sourcesByAgent.get(fromId) ?? [],
  };
}

function instructionsFor(ctx: MissionContext, definition: AgentDefinition): string {
  const lines: string[] = [];

  const reason = ctx.plan.reasons.get(definition.id);
  if (reason) lines.push(`The Task Manager put you on this mission because: ${reason}`);

  const previous = [...ctx.order].reverse().find((id) => id !== definition.id);
  const note = previous ? asText(ctx.outputs.get(previous)?.next_agent_instructions) : '';
  if (previous && note) lines.push(`${previous} left this note for whoever came next: ${note}`);

  for (const [from, output] of ctx.outputs) {
    if (from === definition.id) continue;
    for (const issue of output.issues) {
      if (issue.target_agent !== definition.id) continue;
      lines.push(`${from} raised ${issue.issue_id} against you: ${issue.problem} Required: ${issue.required_action}`);
    }
  }

  return lines.join('\n');
}

function buildEnvelope(
  ctx: MissionContext,
  definition: AgentDefinition,
  correction?: CorrectionRequest,
): MissionEnvelope {
  const dependencies = definition.dependsOn
    .map((id) => ctx.outputs.get(id))
    .filter((output): output is AgentOutput => output !== undefined);

  const handoffs = ctx.order
    .filter((id) => id !== definition.id)
    .map((id) => buildHandoff(ctx, id, definition))
    .filter((handoff): handoff is Handoff => handoff !== null);

  return {
    mission_id: ctx.mission.id,
    mission_reference: ctx.mission.reference,
    original_task: ctx.mission.userTask,
    objective: ctx.mission.objective || ctx.plan.objective,
    user_requirements: ctx.mission.userRequirements,
    constraints: ctx.mission.constraints.length ? ctx.mission.constraints : ctx.plan.constraints,
    geography: ctx.mission.geography,
    language: ctx.mission.language,
    currency: ctx.mission.currency,
    current_stage: definition.stage,
    previous_agent: [...ctx.order].reverse().find((id) => id !== definition.id) ?? null,
    previous_outputs: dependencies,
    handoffs,
    research_questions: ctx.plan.questions,
    available_sources: listSources(ctx.store, ctx.mission.id),
    ...(correction ? { correction } : {}),
    instructions: instructionsFor(ctx, definition),
  };
}

// ---------------------------------------------------------------------------
// Sources: one register per mission, and citations that point into it
// ---------------------------------------------------------------------------

/**
 * Registers everything this agent actually consulted, then rewrites its
 * citations to the mission-wide refs.
 *
 * An agent numbers its own sources from S001 every time, so without this the
 * same "S002" would mean a different page in each agent's output and the chain
 * from a recommendation back to a source would break at the first hand-off.
 * Matching is by URL, which is the only identifier the agent and the register
 * genuinely share.
 */
function registerSources(
  ctx: MissionContext,
  runId: string,
  agentId: string,
  output: Record<string, unknown>,
  harvested: SourceRecord[],
): SourceRecord[] {
  const declared = asArray(output.sources)
    .map(toSource)
    .filter((source) => source.url || source.title);

  const registered = recordSources(ctx.store, ctx.mission.id, runId, agentId, [...harvested, ...declared]);
  if (registered.length === 0 && declared.length === 0) return registered;

  const byUrl = new Map<string, SourceRecord>();
  for (const source of listSources(ctx.store, ctx.mission.id)) {
    const key = urlKey(source.url);
    if (key) byUrl.set(key, source);
  }
  const declaredUrls = new Map<string, string>();
  for (const source of declared) {
    if (source.source_id && source.url) declaredUrls.set(source.source_id, source.url);
  }

  const align = (entry: Record<string, unknown>): void => {
    const url = asText(entry.source_url) || declaredUrls.get(asText(entry.source_id)) || '';
    const match = url ? byUrl.get(urlKey(url)) : undefined;
    if (!match) return;
    entry.source_id = match.source_id;
    entry.source_url = match.url;
    if (!asText(entry.source_title)) entry.source_title = match.title;
  };

  for (const raw of asArray(output.evidence)) align(asRecord(raw));
  for (const raw of asArray(output.findings)) {
    for (const evidence of asArray(asRecord(raw).evidence)) align(asRecord(evidence));
  }
  for (const raw of asArray(output.sources)) {
    const source = asRecord(raw);
    const match = byUrl.get(urlKey(asText(source.url)));
    if (match) source.source_id = match.source_id;
  }

  return registered;
}

// ---------------------------------------------------------------------------
// Confidence monotonicity (§21 rule 6)
// ---------------------------------------------------------------------------

function registerOrigins(ctx: MissionContext, agentId: string, output: AgentOutput): void {
  for (const finding of output.findings) {
    if (!finding.finding_id) continue;
    const keys = finding.evidence.map(evidenceKey).filter(Boolean);
    const existing = ctx.origins.get(finding.finding_id);

    if (existing) {
      // The agent that made a claim may revise its own confidence; everyone
      // else is held to what it first said.
      if (existing.agentId !== agentId) continue;
      for (const key of keys) existing.evidence.add(key);
      existing.confidence = finding.confidence;
      existing.claim = finding.claim;
      continue;
    }

    ctx.origins.set(finding.finding_id, {
      agentId,
      confidence: finding.confidence,
      claim: finding.claim,
      evidence: new Set(keys),
    });
    const key = claimKey(finding.claim);
    if (key && !ctx.claimOrigins.has(key)) ctx.claimOrigins.set(key, finding.finding_id);
  }
}

/**
 * Stops false certainty accumulating down the chain.
 *
 * Restating someone else's claim more confidently is the cheapest way for a
 * pipeline to manufacture authority it never earned, and it is invisible in the
 * final report unless it is caught here. So a later agent that repeats a
 * finding at a higher confidence, with no source the originating agent did not
 * already have, is put back to the confidence the claim was born with — and the
 * timeline says so, because a silent clamp would be its own kind of dishonesty.
 */
function clampRestatedConfidence(ctx: MissionContext, agentId: string, output: AgentOutput): void {
  for (const finding of output.findings) {
    const originId = ctx.origins.has(finding.finding_id)
      ? finding.finding_id
      : ctx.claimOrigins.get(claimKey(finding.claim));
    const origin = originId ? ctx.origins.get(originId) : undefined;
    if (!origin || origin.agentId === agentId) continue;
    if (finding.confidence <= origin.confidence) continue;

    const fresh = finding.evidence
      .map(evidenceKey)
      .filter((key) => key && !origin.evidence.has(key));
    if (fresh.length > 0) continue;

    const raised = finding.confidence;
    finding.confidence = origin.confidence;
    emit(
      ctx,
      'log',
      `${agentId} restated ${originId ?? finding.finding_id} at confidence ${raised} without attaching ` +
        `new evidence. ${origin.agentId} first made that claim at ${origin.confidence}, so it has been ` +
        `clamped back to ${origin.confidence}.`,
      { finding_id: originId ?? finding.finding_id, origin_agent: origin.agentId, from: raised, to: origin.confidence },
      agentId,
    );
  }
}

/**
 * The same rule applied to the Chief AI's headline findings, which cite by id
 * rather than restate. When every reference it gives is a finding id already on
 * record and not one source of its own, the Chief has added no evidence — so it
 * cannot be more confident than the most confident agent it is quoting.
 */
function clampChiefConfidence(ctx: MissionContext, output: AgentOutput): void {
  for (const raw of asArray(output.key_findings)) {
    const entry = asRecord(raw);
    const references = asArray(entry.evidence).map(asText).filter(Boolean);
    if (references.length === 0) continue;
    if (references.some((reference) => /^S\d+$/i.test(reference))) continue;

    const cited = references
      .map((reference) => ctx.origins.get(reference))
      .filter((origin): origin is FindingOrigin => origin !== undefined);
    if (cited.length === 0) continue;

    const ceiling = Math.max(...cited.map((origin) => origin.confidence));
    const stated = asNumber(entry.confidence, ceiling);
    if (stated <= ceiling) continue;

    entry.confidence = ceiling;
    emit(
      ctx,
      'log',
      `chief_ai restated ${references.join(', ')} at confidence ${stated} without attaching new ` +
        `evidence. The agents that made those claims went no higher than ${ceiling}, so it has been ` +
        `clamped back to ${ceiling}.`,
      { references, from: stated, to: ceiling },
      'chief_ai',
    );
  }
}

// ---------------------------------------------------------------------------
// Challenges (§5) — one agent taking issue with another's work
// ---------------------------------------------------------------------------

function recordChallenges(ctx: MissionContext, agentId: string, output: AgentOutput, round: number): void {
  for (const issue of output.issues) {
    const target = asText(issue.target_agent);
    if (!target || target === agentId) continue;

    const origin = ctx.origins.get(issue.target_finding_id);
    recordCorrection(ctx.store, ctx.mission.id, {
      findingId: issue.target_finding_id,
      fromAgent: agentId,
      toAgent: target,
      originalClaim: origin?.claim ?? '',
      correctedClaim: '',
      reason: issue.problem,
      severity: issue.severity,
      round,
      resolved: false,
    });
    emit(
      ctx,
      'challenge',
      `${agentId} challenged ${target}${issue.target_finding_id ? ` over ${issue.target_finding_id}` : ''}: ${issue.problem}`,
      { target_agent: target, finding_id: issue.target_finding_id, severity: issue.severity, issue_id: issue.issue_id },
      agentId,
    );
  }

  // The competitor schema carries its corrections in a field of its own, and
  // "there are no competitors" is the claim most often wrong on this island.
  for (const raw of asArray(output.previous_claims_challenged)) {
    const entry = asRecord(raw);
    const findingId = asText(entry.finding_id);
    const origin = ctx.origins.get(findingId);
    const challenge = asText(entry.challenge);
    if (!challenge) continue;

    recordCorrection(ctx.store, ctx.mission.id, {
      findingId,
      fromAgent: agentId,
      toAgent: origin?.agentId ?? '',
      originalClaim: asText(entry.original_claim) || (origin?.claim ?? ''),
      correctedClaim: asText(entry.corrected_claim),
      reason: challenge,
      severity: asSeverity(entry.severity),
      round,
      resolved: false,
    });
    emit(
      ctx,
      'challenge',
      `${agentId} corrected ${findingId || 'an earlier claim'}${origin ? ` from ${origin.agentId}` : ''}: ${challenge}`,
      { finding_id: findingId, target_agent: origin?.agentId ?? '', severity: asSeverity(entry.severity) },
      agentId,
    );
  }
}

// ---------------------------------------------------------------------------
// Running one agent (§4, §16)
// ---------------------------------------------------------------------------

interface Invocation {
  runId: string;
  /** Validated against the schema this invocation was run under — the agent's
   *  own schema normally, the correction schema on a correction round. */
  output: Record<string, unknown>;
  sources: SourceRecord[];
  notes: string;
  inputTokens: number;
  outputTokens: number;
  repairs: number;
}

async function invokeAgent(
  ctx: MissionContext,
  definition: AgentDefinition,
  attempt: number,
  round: number,
  correction?: CorrectionRequest,
): Promise<Invocation> {
  const envelope = buildEnvelope(ctx, definition, correction);
  const schema = correction ? CORRECTION_SCHEMA(definition.id) : definition.outputSchema;
  const run = startRun(ctx.store, ctx.mission.id, definition.id, attempt, round, envelope);

  emit(
    ctx,
    'agent_started',
    correction
      ? `${definition.name} started a correction round on ${plural(correction.issues.length, 'flagged finding')}.`
      : `${definition.name} started work.`,
    { attempt, round, correcting: Boolean(correction) },
    definition.id,
  );

  try {
    const result = await ctx.provider.run({
      definition,
      envelope,
      signal: ctx.handle.controller.signal,
      onProgress: (note) => emit(ctx, 'agent_progress', `${definition.name}: ${note}`, { round }, definition.id),
    });

    // The provider runs its own repair loop, but the schema is the
    // orchestrator's contract to enforce: output that still does not match it
    // is a failure here, whichever engine produced it.
    const { value, issues } = normaliseAndValidate(result.output, schema);
    if (issues.length) {
      throw new AgentFailure(
        definition.id,
        `${definition.name} returned a report that does not match its schema.`,
        issues,
      );
    }

    const output = value as Record<string, unknown>;
    const sources = registerSources(ctx, run.id, definition.id, output, result.sources);

    return {
      runId: run.id,
      output,
      sources,
      notes: result.notes,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      repairs: result.repairs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishRun(ctx.store, run.id, { status: 'failed', error: message });
    throw error;
  }
}

/**
 * `maxAttempts` tries, then the backup agent if the definition names one, then
 * nothing (§16). Returns null when the agent is genuinely out of options; the
 * caller marks it failed and decides whether the mission can go on without it.
 */
async function attemptAgent(
  ctx: MissionContext,
  definition: AgentDefinition,
  round: number,
  correction?: CorrectionRequest,
): Promise<{ definition: AgentDefinition; invocation: Invocation } | null> {
  for (let attempt = 1; attempt <= islandConfig.maxAttempts; attempt += 1) {
    try {
      const invocation = await invokeAgent(ctx, definition, attempt, round, correction);
      return { definition, invocation };
    } catch (error) {
      ensureLive(ctx.handle);
      if (error instanceof MissionAborted) throw error;

      const message = error instanceof Error ? error.message : String(error);
      const issues = error instanceof AgentFailure ? error.issues : [];
      if (attempt < islandConfig.maxAttempts) {
        emit(
          ctx,
          'agent_retrying',
          `${definition.name} failed on attempt ${attempt} of ${islandConfig.maxAttempts}: ${message} Trying again.`,
          { attempt, round, issues },
          definition.id,
        );
        continue;
      }
      emit(
        ctx,
        'agent_failed',
        `${definition.name} failed after ${plural(attempt, 'attempt')}: ${message}`,
        { attempt, round, issues },
        definition.id,
      );
    }
  }

  const backupId = definition.backupAgentId;
  const backup = backupId ? getAgent(backupId) : undefined;
  if (!backup) return null;

  emit(
    ctx,
    'log',
    `${definition.name} is out of attempts, so ${backup.name} will stand in for it.`,
    { failed_agent: definition.id, backup_agent: backup.id },
    definition.id,
  );

  try {
    const invocation = await invokeAgent(ctx, backup, 1, round, correction);
    return { definition: backup, invocation };
  } catch (error) {
    ensureLive(ctx.handle);
    if (error instanceof MissionAborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    emit(ctx, 'agent_failed', `${backup.name} could not stand in either: ${message}`, { round }, backup.id);
    return null;
  }
}

/**
 * A normal (non-correction) run of one agent, from invocation to stored output.
 * Null means the agent failed and its slot stays empty — downstream agents that
 * depended on it will be marked blocked rather than run on a hole.
 */
async function runStandardAgent(
  ctx: MissionContext,
  definition: AgentDefinition,
  round: number,
): Promise<AgentOutput | null> {
  const attempted = await attemptAgent(ctx, definition, round);
  if (!attempted) {
    ctx.failed.add(definition.id);
    return null;
  }

  const { invocation } = attempted;
  const ranBy = attempted.definition;
  // Validated against the full agent schema above, so every core field is
  // present and this is the one place the cast is safe to make.
  const output = invocation.output as AgentOutput;

  clampRestatedConfidence(ctx, ranBy.id, output);
  if (ranBy.id === 'chief_ai') clampChiefConfidence(ctx, output);

  finishRun(ctx.store, invocation.runId, {
    status: 'completed',
    output,
    notes: invocation.notes,
    confidence: output.confidence,
    inputTokens: invocation.inputTokens,
    outputTokens: invocation.outputTokens,
  });

  registerOrigins(ctx, ranBy.id, output);
  ctx.outputs.set(ranBy.id, output);
  ctx.sourcesByAgent.set(ranBy.id, invocation.sources);
  if (!ctx.order.includes(ranBy.id)) ctx.order.push(ranBy.id);

  if (ranBy.id !== definition.id) {
    // The backup did the work, so the agents downstream of the original get to
    // read it — but the original is still recorded as the failure it was.
    ctx.outputs.set(definition.id, output);
    ctx.failed.add(definition.id);
  }

  emit(
    ctx,
    'agent_completed',
    `${ranBy.name} finished: ${plural(output.findings.length, 'finding')}, ` +
      `${plural(output.issues.length, 'issue')} raised, ${plural(invocation.sources.length, 'source')} ` +
      `registered, confidence ${percent(output.confidence)}.`,
    {
      round,
      confidence: output.confidence,
      findings: output.findings.length,
      issues: output.issues.length,
      sources: invocation.sources.length,
      repairs: invocation.repairs,
      input_tokens: invocation.inputTokens,
      output_tokens: invocation.outputTokens,
    },
    ranBy.id,
  );

  recordChallenges(ctx, ranBy.id, output, round);

  for (const downstream of ctx.selected) {
    const dependent = requireAgent(downstream);
    if (!dependent.dependsOn.includes(ranBy.id)) continue;
    emit(
      ctx,
      'handoff',
      `${ranBy.name} handed its work to ${dependent.name}.`,
      { from: ranBy.id, to: dependent.id },
      ranBy.id,
    );
  }

  return output;
}

/** An agent whose dependency never produced anything. Recorded as blocked, with
 *  a run row saying what it was waiting for — never quietly dropped. */
function markBlocked(ctx: MissionContext, definition: AgentDefinition, missing: string[]): void {
  const reason =
    `${definition.name} could not run: it depends on ${missing.join(' and ')}, which did not complete.`;
  const run = startRun(ctx.store, ctx.mission.id, definition.id, 1, 0, buildEnvelope(ctx, definition));
  finishRun(ctx.store, run.id, { status: 'blocked', error: reason });
  ctx.failed.add(definition.id);
  emit(ctx, 'agent_skipped', reason, { reason: 'blocked', dependencies: missing }, definition.id);
}

/**
 * Runs a wave with at most `limit` agents in flight (§24).
 *
 * Every lane is awaited even when one of them throws, because an abort that
 * unwound the mission while two agents were still mid-call would close the
 * mission out and then let those agents write their runs afterwards.
 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const errors: unknown[] = [];
  let cursor = 0;

  const lanes = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const item = items[cursor];
      cursor += 1;
      if (item === undefined) return;
      try {
        await worker(item);
      } catch (error) {
        errors.push(error);
      }
    }
  });
  await Promise.all(lanes);

  const aborted = errors.find((error) => error instanceof MissionAborted);
  if (aborted) throw aborted;
  if (errors.length > 0) throw errors[0];
}

// ---------------------------------------------------------------------------
// The verification gate and the correction loop (§7, §8)
// ---------------------------------------------------------------------------

interface Flag {
  findingId: string;
  agent: string;
  reason: string;
  severity: Severity;
  action: string;
}

interface GateReading {
  passed: boolean;
  flags: Flag[];
  verified: string[];
  contradictions: { conflict: string; resolution: string }[];
}

function readGate(output: AgentOutput): GateReading {
  return {
    passed: output.verification_passed === true,
    flags: asArray(output.flagged_findings).map((raw) => {
      const entry = asRecord(raw);
      return {
        findingId: asText(entry.finding_id),
        agent: asText(entry.agent),
        reason: asText(entry.reason),
        severity: asSeverity(entry.severity, 'high'),
        action: asText(entry.recommended_action),
      };
    }),
    verified: asArray(output.verified_findings).map(asText).filter(Boolean),
    contradictions: asArray(output.contradictions).map((raw) => {
      const entry = asRecord(raw);
      return {
        conflict:
          asText(entry.conflict) ||
          [asText(entry.claim_a), asText(entry.claim_b)].filter(Boolean).join(' vs '),
        resolution: asText(entry.resolution),
      };
    }),
  };
}

function persistGate(ctx: MissionContext, reading: GateReading, round: number): void {
  const records: Omit<VerificationRecord, 'id' | 'missionId' | 'createdAt'>[] = [];

  for (const findingId of reading.verified) {
    records.push({
      findingId,
      agentId: ctx.origins.get(findingId)?.agentId ?? '',
      status: 'verified',
      reason: 'Checked by the verification agent and found to hold up.',
      severity: 'low',
      recommendedAction: '',
      correctedValue: '',
      resolved: true,
      round,
    });
  }

  for (const flag of reading.flags) {
    records.push({
      findingId: flag.findingId,
      agentId: flag.agent || (ctx.origins.get(flag.findingId)?.agentId ?? ''),
      status: flag.severity === 'high' ? 'high_risk' : 'needs_verification',
      reason: flag.reason,
      severity: flag.severity,
      recommendedAction: flag.action,
      correctedValue: '',
      resolved: false,
      round,
    });
  }

  for (const contradiction of reading.contradictions) {
    if (!contradiction.conflict) continue;
    records.push({
      findingId: '',
      agentId: '',
      status: 'contradiction',
      reason: contradiction.conflict,
      severity: 'high',
      recommendedAction: contradiction.resolution,
      correctedValue: '',
      resolved: Boolean(contradiction.resolution),
      round,
    });
  }

  recordVerifications(ctx.store, ctx.mission.id, round, records);
  emit(
    ctx,
    'verification_result',
    reading.passed
      ? `Verification passed on round ${round}: ${plural(reading.verified.length, 'finding')} hold up and ` +
        'nothing is left flagged.'
      : `Verification failed on round ${round}: ${plural(reading.flags.length, 'finding')} flagged and ` +
        `${plural(reading.contradictions.length, 'contradiction')} found.`,
    {
      round,
      passed: reading.passed,
      flagged: reading.flags.length,
      verified: reading.verified.length,
      contradictions: reading.contradictions.length,
    },
    'risk_verification',
  );
}

/** Which agent has to answer for a flagged finding: whoever the verifier named,
 *  or failing that whoever first made the claim. */
function routeFlags(ctx: MissionContext, flags: Flag[], round: number): {
  byAgent: Map<string, CorrectionIssue[]>;
  unroutable: Flag[];
} {
  const byAgent = new Map<string, CorrectionIssue[]>();
  const unroutable: Flag[] = [];

  flags.forEach((flag, index) => {
    const named = flag.agent && ctx.outputs.has(flag.agent) ? flag.agent : '';
    const owner = named || ctx.origins.get(flag.findingId)?.agentId || '';
    if (!owner || owner === 'risk_verification' || !ctx.outputs.has(owner)) {
      unroutable.push(flag);
      return;
    }
    const issues = byAgent.get(owner) ?? [];
    issues.push({
      issue_id: `V${round}-${index + 1}`,
      agent: owner,
      finding_id: flag.findingId,
      problem: flag.reason,
      severity: flag.severity,
      required_action: flag.action,
    });
    byAgent.set(owner, issues);
  });

  return { byAgent, unroutable };
}

/**
 * Folds a correction round back into the agent's stored output.
 *
 * The original run row is left exactly as it was — a correction is a new run,
 * and the audit trail is worth more than a tidy history. What changes is the
 * output the rest of the mission reads: corrected claims replace the ones they
 * correct, a claim the agent could not settle is relabelled rather than quietly
 * kept, and every single change is written to island_corrections with the text
 * before and the text after.
 */
function mergeCorrection(
  ctx: MissionContext,
  definition: AgentDefinition,
  previous: AgentOutput,
  correction: Record<string, unknown>,
  issues: CorrectionIssue[],
  round: number,
): { output: AgentOutput; resolved: number; unresolved: number } {
  const merged = JSON.parse(JSON.stringify(previous)) as AgentOutput;
  const byFinding = new Map(issues.map((issue) => [issue.finding_id, issue]));
  let resolved = 0;
  let unresolved = 0;

  for (const raw of asArray(correction.corrections)) {
    const entry = asRecord(raw);
    const findingId = asText(entry.finding_id);
    const correctedClaim = asText(entry.corrected_claim);
    const wasResolved = entry.resolved === true;
    const severity = byFinding.get(findingId)?.severity ?? 'medium';

    const finding = merged.findings.find((candidate) => candidate.finding_id === findingId);
    const originalClaim = finding?.claim ?? asText(entry.previous_claim);

    if (finding && correctedClaim) finding.claim = correctedClaim;
    if (finding && !wasResolved) {
      // An issue the agent could not settle must not keep a label that says it
      // is settled; the report carries it as unresolved either way.
      finding.label = severity === 'high' ? 'HIGH_RISK' : 'NEEDS_VERIFICATION';
    }

    recordCorrection(ctx.store, ctx.mission.id, {
      findingId,
      fromAgent: 'risk_verification',
      toAgent: definition.id,
      originalClaim,
      correctedClaim: correctedClaim || originalClaim,
      reason: asText(entry.reason_for_change),
      severity,
      round,
      resolved: wasResolved,
    });

    if (wasResolved) {
      resolved += 1;
      resolveVerification(ctx.store, ctx.mission.id, findingId, correctedClaim || originalClaim);
    } else {
      unresolved += 1;
    }
  }

  for (const raw of asArray(correction.findings)) {
    const entry = asRecord(raw);
    const findingId = asText(entry.finding_id);
    if (!findingId) continue;
    const replacement: Finding = {
      finding_id: findingId,
      claim: asText(entry.claim),
      category: asText(entry.category),
      importance: asImportance(entry.importance),
      label: (asText(entry.label) || 'NEEDS_VERIFICATION') as Label,
      evidence: asArray(entry.evidence).map((item) => {
        const support = asRecord(item);
        return {
          source_id: asText(support.source_id),
          source_title: asText(support.source_title),
          source_url: asText(support.source_url),
          support: asText(support.support),
        };
      }),
      confidence: clamp01(asNumber(entry.confidence, 0)),
    };
    const index = merged.findings.findIndex((candidate) => candidate.finding_id === findingId);
    if (index >= 0) merged.findings[index] = replacement;
    else merged.findings.push(replacement);
  }

  asArray(correction.remaining_uncertainties).forEach((raw, index) => {
    const text = asText(raw);
    if (!text) return;
    merged.issues.push({
      issue_id: `U${round}-${index + 1}`,
      target_agent: '',
      target_finding_id: '',
      problem: text,
      severity: 'medium',
      required_action:
        `Still unsettled after correction round ${round}. A person must establish this before the ` +
        'work that rests on it is relied on.',
    });
  });

  // Rule 6 again, in the place it is most tempting to break: a correction may
  // only come back more confident if it came back with something new.
  const stated = clamp01(asNumber(correction.confidence, merged.confidence));
  const broughtEvidence =
    asArray(correction.sources).length > 0 ||
    asArray(correction.corrections).some((raw) => asArray(asRecord(raw).new_sources).length > 0);
  merged.confidence = broughtEvidence ? stated : Math.min(merged.confidence, stated);
  merged.status = 'corrected';

  return { output: merged, resolved, unresolved };
}

async function runCorrection(
  ctx: MissionContext,
  definition: AgentDefinition,
  issues: CorrectionIssue[],
  round: number,
): Promise<void> {
  const previous = ctx.outputs.get(definition.id);
  if (!previous) return;

  const request: CorrectionRequest = {
    mission_id: ctx.mission.id,
    correction_required: true,
    issues,
    retry_number: round,
    maximum_retries: islandConfig.maxCorrectionRounds,
  };

  emit(
    ctx,
    'correction_requested',
    `${definition.name} was sent ${plural(issues.length, 'flagged finding')} to correct ` +
      `(round ${round} of ${islandConfig.maxCorrectionRounds}).`,
    { round, issues },
    definition.id,
  );

  const attempted = await attemptAgent(ctx, definition, round, request);
  if (!attempted) {
    emit(
      ctx,
      'log',
      `${definition.name} could not run its correction round, so the findings flagged against it stay ` +
        'unresolved and are carried into the report as they are.',
      { round, issues: issues.length },
      definition.id,
    );
    return;
  }

  const { invocation } = attempted;
  const { output, resolved, unresolved } = mergeCorrection(
    ctx,
    definition,
    previous,
    invocation.output,
    issues,
    round,
  );

  // The merged output is what the rest of the mission reads, so it is the one
  // stored on the correction run — the original run keeps its original answer.
  finishRun(ctx.store, invocation.runId, {
    status: 'completed',
    output,
    notes: invocation.notes,
    confidence: output.confidence,
    inputTokens: invocation.inputTokens,
    outputTokens: invocation.outputTokens,
  });

  ctx.outputs.set(definition.id, output);
  ctx.sourcesByAgent.set(definition.id, [
    ...(ctx.sourcesByAgent.get(definition.id) ?? []),
    ...invocation.sources,
  ]);
  registerOrigins(ctx, definition.id, output);

  emit(
    ctx,
    'correction_applied',
    `${definition.name} came back from round ${round} with ${plural(resolved, 'issue')} resolved and ` +
      `${unresolved} still open.`,
    { round, resolved, unresolved, confidence: output.confidence },
    definition.id,
  );
}

/**
 * Holds the mission at the gate until verification passes or the rounds run out.
 *
 * Past the cap the flagged findings are neither dropped nor quietly marked
 * fine: they stay unresolved in island_verifications, which is exactly where
 * the final report reads its unresolved-issues section from.
 */
async function runVerificationGate(ctx: MissionContext): Promise<void> {
  if (!ctx.selected.includes('risk_verification')) return;

  for (let round = 0; ; round += 1) {
    const output = ctx.outputs.get('risk_verification');
    if (!output) return;

    const reading = readGate(output);
    persistGate(ctx, reading, round);
    if (reading.passed) return;

    if (round >= islandConfig.maxCorrectionRounds) {
      emit(
        ctx,
        'log',
        `The verification gate still did not pass after ${plural(round, 'correction round')}. ` +
          `${plural(reading.flags.length, 'finding')} are carried into the report as unresolved rather ` +
          'than recorded as settled.',
        { round, unresolved: reading.flags.length },
        'risk_verification',
      );
      return;
    }

    const { byAgent, unroutable } = routeFlags(ctx, reading.flags, round + 1);
    if (unroutable.length > 0) {
      emit(
        ctx,
        'log',
        `${plural(unroutable.length, 'flagged finding')} name no agent that ran on this mission, so ` +
          'there is nobody to send them back to. They stay unresolved.',
        { findings: unroutable.map((flag) => flag.findingId) },
        'risk_verification',
      );
    }
    if (byAgent.size === 0) return;

    const nextRound = round + 1;
    await runPool([...byAgent.entries()], islandConfig.maxConcurrentAgents, async ([agentId, issues]) => {
      await gate(ctx.handle);
      await runCorrection(ctx, requireAgent(agentId), issues, nextRound);
    });

    await gate(ctx.handle);
    const rechecked = await runStandardAgent(ctx, requireAgent('risk_verification'), nextRound);
    if (!rechecked) {
      emit(
        ctx,
        'log',
        'The verification agent could not re-check the corrected work, so everything it flagged stays ' +
          'unresolved in the report.',
        { round: nextRound },
        'risk_verification',
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// The plan the Task Manager hands down (§1)
// ---------------------------------------------------------------------------

function readPlan(ctx: MissionContext): void {
  const output = ctx.outputs.get('task_manager');
  if (!output) return;

  const definition = asRecord(output.task_definition);
  ctx.plan.objective = asText(definition.objective);
  ctx.plan.constraints = asArray(definition.constraints).map(asText).filter(Boolean);

  ctx.plan.questions = asArray(output.research_questions)
    .map((raw, index) => {
      const entry = asRecord(raw);
      return {
        question_id: asText(entry.question_id) || `Q${String(index + 1).padStart(3, '0')}`,
        question: asText(entry.question),
        priority: asImportance(entry.priority),
      };
    })
    .filter((question) => question.question);

  for (const raw of asArray(output.required_agents)) {
    const entry = asRecord(raw);
    const id = asText(entry.agent_id);
    if (!id || !getAgent(id)) continue;
    ctx.plan.agents.add(id);
    const reason = asText(entry.reason);
    if (reason) ctx.plan.reasons.set(id, reason);
  }

  for (const raw of asArray(output.execution_order)) {
    const id = asText(raw);
    if (id && getAgent(id)) ctx.plan.agents.add(id);
  }
}

/**
 * Narrows the roster to what the plan actually needs.
 *
 * Two things the plan is not allowed to do: add back an agent the merchant
 * switched off, and drop the two agents that keep the rest of the mission
 * honest. A plan that named nothing usable is ignored rather than obeyed into
 * an empty mission.
 */
function narrowRoster(ctx: MissionContext, roster: string[]): string[] {
  const runnable = roster.filter((id) => id !== 'task_manager');
  if (ctx.plan.agents.size === 0) return runnable;

  const selected = runnable.filter((id) => ctx.plan.agents.has(id) || ALWAYS_KEEP.has(id));
  if (selected.length === 0) return runnable;

  for (const id of runnable) {
    if (selected.includes(id)) continue;
    emit(
      ctx,
      'agent_skipped',
      `${requireAgent(id).name} was left out: the Task Manager's plan does not need it for this mission.`,
      { reason: 'not_in_plan' },
      id,
    );
  }
  return selected;
}

// ---------------------------------------------------------------------------
// The mission loop
// ---------------------------------------------------------------------------

function closeOpenRuns(store: TenantStore, missionId: string, reason: string): void {
  for (const run of listRuns(store, missionId)) {
    if (run.completedAt) continue;
    finishRun(store, run.id, { status: 'failed', error: reason });
  }
}

async function runMission(store: TenantStore, mission: MissionRecord, handle: ActiveMission): Promise<void> {
  const provider = getProvider();
  const ctx: MissionContext = {
    store,
    mission,
    handle,
    provider,
    outputs: new Map(),
    order: [],
    sourcesByAgent: new Map(),
    origins: new Map(),
    claimOrigins: new Map(),
    plan: { objective: '', constraints: [], questions: [], agents: new Set(), reasons: new Map() },
    failed: new Set(),
    selected: [],
  };

  try {
    updateMission(store, mission.id, {
      status: 'planning',
      engine: provider.kind,
      startedAt: nowIso(),
      currentStage: 'plan',
      error: null,
    });
    emit(ctx, 'mission_started', `Mission ${mission.reference} started on the ${provider.label} engine.`, {
      engine: provider.kind,
      mode: mission.mode,
    });

    const roster = mission.enabledAgents.filter((id) => getAgent(id) !== undefined);
    if (roster.length === 0) {
      throw new Error('This mission has no island agents enabled, so there is nothing to run.');
    }

    let stageRan = false;
    if (roster.includes('task_manager')) {
      emit(ctx, 'stage_started', `${STAGE_LABEL.plan} started.`, { stage: 'plan' });
      await gate(handle);
      await runStandardAgent(ctx, requireAgent('task_manager'), 0);
      readPlan(ctx);
      stageRan = true;
    }

    ctx.selected = narrowRoster(ctx, roster);
    updateMission(store, mission.id, { status: 'running' });

    for (const stage of STAGE_ORDER) {
      if (stage === 'plan') continue;
      const inStage = ctx.selected.filter((id) => requireAgent(id).stage === stage);
      if (inStage.length === 0) continue;

      if (stageRan) await awaitApproval(ctx, stage);
      stageRan = true;
      updateMission(store, mission.id, { status: 'running', currentStage: stage, pendingApprovalStage: null });
      emit(ctx, 'stage_started', `${STAGE_LABEL[stage]} started with ${plural(inStage.length, 'agent')}.`, {
        stage,
        agents: inStage,
      });

      for (const wave of planWaves(inStage)) {
        for (const agentId of wave) {
          emit(ctx, 'agent_queued', `${requireAgent(agentId).name} is queued.`, { stage }, agentId);
        }
        await runPool(wave, islandConfig.maxConcurrentAgents, async (agentId) => {
          await gate(handle);
          const definition = requireAgent(agentId);
          const missing = definition.dependsOn.filter(
            (dependency) => ctx.selected.includes(dependency) && !ctx.outputs.has(dependency),
          );
          if (missing.length > 0) {
            markBlocked(ctx, definition, missing);
            return;
          }
          await runStandardAgent(ctx, definition, 0);
        });
      }

      if (stage === 'verify') await runVerificationGate(ctx);
    }

    if (ctx.outputs.size === 0) {
      throw new Error('Every agent on this mission failed, so there is nothing to report.');
    }

    const report = buildFinalReport(store, mission, listRuns(store, mission.id));
    updateMission(store, mission.id, {
      status: 'completed',
      finalReport: report,
      decision: report.recommendation.decision,
      confidence: report.overall_confidence,
      currentStage: null,
      pendingApprovalStage: null,
      completedAt: nowIso(),
      error: null,
    });
    emit(
      ctx,
      'mission_completed',
      `Mission ${mission.reference} finished: ${report.recommendation.decision.replace(/_/g, ' ')} at ` +
        `${percent(report.overall_confidence)} confidence.`,
      {
        decision: report.recommendation.decision,
        confidence: report.overall_confidence,
        unresolved: report.unresolved_issues.length,
      },
    );
  } catch (error) {
    if (error instanceof MissionAborted || handle.controller.signal.aborted) {
      if (!handle.settled) {
        const message = 'Mission aborted. Nothing further will run and the work recorded so far is kept.';
        updateMission(store, mission.id, {
          status: 'aborted',
          currentStage: null,
          pendingApprovalStage: null,
          completedAt: nowIso(),
        });
        appendEvent(store, mission.id, { type: 'mission_aborted', message, payload: {} });
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      updateMission(store, mission.id, {
        status: 'failed',
        error: message,
        currentStage: null,
        pendingApprovalStage: null,
        completedAt: nowIso(),
      });
      appendEvent(store, mission.id, {
        type: 'mission_failed',
        message: `Mission ${mission.reference} failed: ${message}`,
        payload: {},
      });
    }
  } finally {
    handle.settled = true;
    active.delete(mission.id);
    // Whatever happened above, no run row is left open: an agent row with no
    // completed_at is the same lie at agent level that a running mission with
    // no loop is at mission level.
    closeOpenRuns(store, mission.id, 'The mission ended before this agent finished.');
  }
}

// ---------------------------------------------------------------------------
// Control surface
// ---------------------------------------------------------------------------

export function startMission(opts: StartOptions): void {
  const { store, missionId } = opts;
  const mission = getMission(store, missionId);
  if (active.has(missionId)) return;

  if (mission.status !== 'created') {
    throw conflict('This mission has already been started. Create a new one to run the work again.');
  }

  if (!islandConfig.enabled) {
    const reason =
      'The AI Agent Island is switched off on this server (ISLAND_ENABLED=false), so the mission ' +
      'cannot run.';
    updateMission(store, missionId, { status: 'failed', error: reason, completedAt: nowIso() });
    appendEvent(store, missionId, {
      type: 'mission_failed',
      message: reason,
      payload: { reason: 'island_disabled' },
    });
    return;
  }

  const handle: ActiveMission = {
    controller: new AbortController(),
    paused: false,
    resumeResolver: null,
    approvalResolver: null,
    settled: false,
  };
  active.set(missionId, handle);

  // Deliberately not awaited: the caller is an HTTP request and the mission
  // takes minutes. `runMission` handles its own failures, so this catch only
  // exists so a bug in the handling itself cannot become an unhandled rejection.
  void runMission(store, mission, handle).catch((error) => {
    console.error('[island] mission loop escaped its own error handling', error);
  });
}

/**
 * Closes out a mission nothing is running any more.
 *
 * A paused or half-approved mission does not survive a restart — the loop lived
 * in the process that went away. Saying so and failing it is the only honest
 * answer; leaving it looking resumable would mean it never finished at all.
 */
function stranded(store: TenantStore, mission: MissionRecord): MissionRecord {
  const reason =
    'Nothing is running this mission any more — the server restarted while it was on hold. It has ' +
    'been marked failed; start a new mission to pick the work up again.';
  const updated = updateMission(store, mission.id, {
    status: 'failed',
    error: reason,
    currentStage: null,
    pendingApprovalStage: null,
    completedAt: nowIso(),
  });
  appendEvent(store, mission.id, {
    type: 'mission_failed',
    message: reason,
    payload: { reason: 'no_running_loop' },
  });
  closeOpenRuns(store, mission.id, reason);
  return updated;
}

export function pauseMission(store: TenantStore, missionId: string): MissionRecord {
  const mission = getMission(store, missionId);
  const handle = active.get(missionId);
  if (!handle) throw conflict('Nothing is running this mission, so there is nothing to pause.');
  if (handle.paused) return mission;

  handle.paused = true;
  const updated = updateMission(store, missionId, { status: 'paused' });
  appendEvent(store, missionId, {
    type: 'mission_paused',
    message:
      'Mission paused. The agent already working will finish what it is doing, and nothing new will ' +
      'start until you resume.',
    payload: {},
  });
  return updated;
}

export function resumeMission(store: TenantStore, missionId: string): MissionRecord {
  const mission = getMission(store, missionId);
  const handle = active.get(missionId);
  if (!handle) return stranded(store, mission);
  if (mission.status === 'awaiting_approval') {
    throw conflict('This mission is waiting for approval rather than paused. Approve the next stage to continue.');
  }
  if (!handle.paused) return mission;

  handle.paused = false;
  const updated = updateMission(store, missionId, { status: 'running' });
  appendEvent(store, missionId, { type: 'mission_resumed', message: 'Mission resumed.', payload: {} });
  handle.resumeResolver?.();
  return updated;
}

export function abortMission(store: TenantStore, missionId: string): MissionRecord {
  const mission = getMission(store, missionId);
  if (TERMINAL.has(mission.status)) throw conflict('This mission has already finished.');

  const handle = active.get(missionId);
  const message = 'Mission aborted. Nothing further will run and the work recorded so far is kept.';
  if (handle) {
    // Marked settled before the abort lands so the loop does not write a second
    // terminal state over this one.
    handle.settled = true;
    handle.paused = false;
    handle.controller.abort();
  }

  const updated = updateMission(store, missionId, {
    status: 'aborted',
    currentStage: null,
    pendingApprovalStage: null,
    completedAt: nowIso(),
  });
  appendEvent(store, missionId, { type: 'mission_aborted', message, payload: {} });
  if (!handle) closeOpenRuns(store, missionId, message);
  return updated;
}

export function approveStage(store: TenantStore, missionId: string, note?: string): MissionRecord {
  const mission = getMission(store, missionId);
  const handle = active.get(missionId);
  if (!handle) return stranded(store, mission);
  if (mission.status !== 'awaiting_approval') {
    throw conflict('This mission is not waiting for approval.');
  }

  const stage = mission.pendingApprovalStage;
  const updated = updateMission(store, missionId, { status: 'running', pendingApprovalStage: null });
  appendEvent(store, missionId, {
    type: 'approval_granted',
    message: stage
      ? `The ${STAGE_LABEL[stage]} stage was approved and starts now.`
      : 'The next stage was approved and starts now.',
    payload: { stage, note: note ?? '' },
  });
  handle.approvalResolver?.();
  return updated;
}
