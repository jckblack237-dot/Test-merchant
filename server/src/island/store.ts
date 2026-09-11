/**
 * Everything the island keeps.
 *
 * Missions are merchant-owned — a mission asks a question about someone's
 * business strategy — so every read and write here goes through `TenantStore`,
 * which binds merchant_id itself. The one exception is
 * `reconcileInterruptedMissions`, which is platform maintenance across all
 * merchants and says so.
 *
 * The other rule this module holds to: nothing it reads back can take an
 * endpoint down. JSON columns are parsed defensively and a row that cannot be
 * parsed degrades to its empty value, because one malformed mission must not
 * cost a merchant the list of the other forty.
 */
import { getDb, type Db } from '../db';
import type { TenantStore } from '../db/tenant';
import { conflict, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';
import { engineKind } from './config';
import { publish } from './events';
import type {
  AgentOutput,
  AgentRunRecord,
  AgentState,
  CorrectionRecord,
  Decision,
  EngineKind,
  FinalReport,
  MissionEnvelope,
  MissionEvent,
  MissionEventType,
  MissionMode,
  MissionRecord,
  MissionStatus,
  Reliability,
  SourceRecord,
  SourceType,
  Stage,
  VerificationRecord,
} from './types';

// ---------------------------------------------------------------------------
// Row shapes and defensive parsing
// ---------------------------------------------------------------------------

type MissionRow = {
  id: string;
  merchant_id: string;
  reference: string;
  user_task: string;
  objective: string;
  geography: string;
  language: string;
  currency: string;
  constraints: string;
  user_requirements: string;
  status: string;
  mode: string;
  engine: string;
  enabled_agents: string;
  current_stage: string | null;
  pending_stage: string | null;
  decision: string | null;
  confidence: number | null;
  final_report: string | null;
  error: string | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type AgentRunRow = {
  id: string;
  mission_id: string;
  agent_id: string;
  attempt: number;
  round: number;
  status: string;
  input: string | null;
  output: string | null;
  notes: string | null;
  error: string | null;
  confidence: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
};

type SourceRow = {
  id: string;
  mission_id: string;
  run_id: string | null;
  agent_id: string;
  source_ref: string;
  title: string;
  url: string;
  source_type: string;
  reliability: string;
  created_at: string;
};

type VerificationRow = {
  id: string;
  mission_id: string;
  finding_id: string;
  agent_id: string;
  status: string;
  reason: string;
  severity: string;
  recommended_action: string;
  corrected_value: string;
  resolved: number;
  round: number;
  created_at: string;
};

type CorrectionRow = {
  id: string;
  mission_id: string;
  finding_id: string;
  from_agent: string;
  to_agent: string;
  original_claim: string;
  corrected_claim: string;
  reason: string;
  severity: string;
  round: number;
  resolved: number;
  created_at: string;
};

type EventRow = {
  id: string;
  mission_id: string;
  seq: number;
  type: string;
  agent_id: string | null;
  message: string;
  payload: string;
  created_at: string;
};

type FollowupRow = {
  id: string;
  mission_id: string;
  question: string;
  answer: string;
  status: string;
  asked_by: string | null;
  created_at: string;
};

function parseObject<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** Anything that is not a list of strings comes back as no list at all. */
function parseStringList(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function shapeMission(row: MissionRow): MissionRecord {
  return {
    id: row.id,
    reference: row.reference,
    merchantId: row.merchant_id,
    userTask: row.user_task,
    objective: row.objective,
    geography: row.geography,
    language: row.language,
    currency: row.currency,
    constraints: parseStringList(row.constraints),
    userRequirements: parseStringList(row.user_requirements),
    status: row.status as MissionStatus,
    mode: row.mode as MissionMode,
    engine: row.engine as EngineKind,
    enabledAgents: parseStringList(row.enabled_agents),
    currentStage: (row.current_stage as Stage | null) ?? null,
    pendingApprovalStage: (row.pending_stage as Stage | null) ?? null,
    decision: (row.decision as Decision | null) ?? null,
    confidence: row.confidence,
    finalReport: parseObject<FinalReport | null>(row.final_report, null),
    error: row.error,
    // created_by is nulled when the staff member who started the mission is
    // removed; the mission and its audit trail outlive them.
    createdBy: row.created_by ?? '',
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function shapeRun(row: AgentRunRow): AgentRunRecord {
  return {
    id: row.id,
    missionId: row.mission_id,
    agentId: row.agent_id,
    attempt: row.attempt,
    round: row.round,
    status: row.status as AgentState,
    input: parseObject<MissionEnvelope | null>(row.input, null),
    output: parseObject<AgentOutput | null>(row.output, null),
    error: row.error,
    confidence: row.confidence,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    notes: row.notes,
  };
}

function shapeSource(row: SourceRow): SourceRecord {
  return {
    source_id: row.source_ref,
    title: row.title,
    url: row.url,
    source_type: row.source_type as SourceType,
    reliability: row.reliability as Reliability,
  };
}

function shapeVerification(row: VerificationRow): VerificationRecord {
  return {
    id: row.id,
    missionId: row.mission_id,
    findingId: row.finding_id,
    agentId: row.agent_id,
    status: row.status as VerificationRecord['status'],
    reason: row.reason,
    severity: row.severity as VerificationRecord['severity'],
    recommendedAction: row.recommended_action,
    correctedValue: row.corrected_value,
    resolved: row.resolved === 1,
    round: row.round,
    createdAt: row.created_at,
  };
}

function shapeCorrection(row: CorrectionRow): CorrectionRecord {
  return {
    id: row.id,
    missionId: row.mission_id,
    findingId: row.finding_id,
    fromAgent: row.from_agent,
    toAgent: row.to_agent,
    originalClaim: row.original_claim,
    correctedClaim: row.corrected_claim,
    reason: row.reason,
    severity: row.severity as CorrectionRecord['severity'],
    round: row.round,
    resolved: row.resolved === 1,
    createdAt: row.created_at,
  };
}

function shapeEvent(row: EventRow): MissionEvent {
  return {
    id: row.id,
    missionId: row.mission_id,
    seq: row.seq,
    type: row.type as MissionEventType,
    agentId: row.agent_id,
    payload: parseObject<Record<string, unknown>>(row.payload, {}),
    message: row.message,
    createdAt: row.created_at,
  };
}

function shapeFollowup(row: FollowupRow): FollowupRecord {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export interface CreateMissionInput {
  userTask: string;
  objective?: string;
  geography?: string;
  language?: string;
  currency?: string;
  constraints?: string[];
  userRequirements?: string[];
  mode: MissionMode;
  enabledAgents: string[];
  createdBy: string | null;
  createdByName: string;
}

/** The fields a running mission is allowed to change about itself. */
export type MissionPatch = Partial<
  Pick<
    MissionRecord,
    | 'status'
    | 'mode'
    | 'engine'
    | 'objective'
    | 'geography'
    | 'language'
    | 'currency'
    | 'constraints'
    | 'userRequirements'
    | 'enabledAgents'
    | 'currentStage'
    | 'pendingApprovalStage'
    | 'decision'
    | 'confidence'
    | 'finalReport'
    | 'error'
    | 'startedAt'
    | 'completedAt'
  >
>;

function formatReference(year: number, sequence: number): string {
  return `MISSION-${year}-${String(sequence).padStart(3, '0')}`;
}

/** First free number in this merchant's sequence for the given year. */
function nextMissionNumber(store: TenantStore, year: number): number {
  let sequence = store.count('island_missions', 'reference LIKE @prefix', {
    prefix: `MISSION-${year}-%`,
  });
  sequence += 1;
  // A deleted mission leaves a gap, so the count alone can name a reference
  // that is already taken. Walk forward until one is free.
  while (
    store.findBy('island_missions', 'reference = @reference', {
      reference: formatReference(year, sequence),
    })
  ) {
    sequence += 1;
  }
  return sequence;
}

/** "MISSION-2026-001", counted per merchant and per calendar year (UTC). */
export function nextMissionReference(store: TenantStore): string {
  const year = new Date().getUTCFullYear();
  return formatReference(year, nextMissionNumber(store, year));
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

const REFERENCE_ATTEMPTS = 25;

export function createMission(store: TenantStore, input: CreateMissionInput): MissionRecord {
  const values = {
    user_task: input.userTask,
    objective: input.objective ?? '',
    geography: input.geography ?? '',
    language: input.language ?? 'English',
    currency: input.currency ?? 'USD',
    constraints: JSON.stringify(input.constraints ?? []),
    user_requirements: JSON.stringify(input.userRequirements ?? []),
    status: 'created',
    mode: input.mode,
    // Which engine answered is recorded at creation so a report produced with
    // no credential configured can never be mistaken for real research later.
    engine: engineKind(),
    enabled_agents: JSON.stringify(input.enabledAgents),
    created_by: input.createdBy,
    created_by_name: input.createdByName,
    created_at: nowIso(),
  };

  const year = new Date().getUTCFullYear();
  let sequence = nextMissionNumber(store, year);

  // Two missions created in the same tick would compute the same reference.
  // UNIQUE(merchant_id, reference) is what actually decides, so let it decide
  // and take the next number rather than guarding with a lock.
  for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
    try {
      const row = store.insert<MissionRow>('island_missions', {
        id: newId('msn'),
        reference: formatReference(year, sequence),
        ...values,
      });
      return shapeMission(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      sequence += 1;
    }
  }
  throw conflict('Could not allocate a mission reference. Please try again.');
}

export function findMission(store: TenantStore, id: string): MissionRecord | null {
  const row = store.find<MissionRow>('island_missions', id);
  return row ? shapeMission(row) : null;
}

export function getMission(store: TenantStore, id: string): MissionRecord {
  const mission = findMission(store, id);
  if (!mission) throw notFound('Mission not found.');
  return mission;
}

export function listMissions(
  store: TenantStore,
  opts: { limit?: number; offset?: number; status?: MissionStatus } = {},
): { missions: MissionRecord[]; total: number } {
  const where = opts.status ? 'status = @status' : undefined;
  const params = opts.status ? { status: opts.status } : {};
  const rows = store.list<MissionRow>('island_missions', {
    where,
    params,
    orderBy: 'created_at DESC',
    limit: opts.limit ?? 25,
    offset: opts.offset ?? 0,
  });
  return { missions: rows.map(shapeMission), total: store.count('island_missions', where, params) };
}

export function updateMission(store: TenantStore, id: string, patch: MissionPatch): MissionRecord {
  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.mode !== undefined) values.mode = patch.mode;
  if (patch.engine !== undefined) values.engine = patch.engine;
  if (patch.objective !== undefined) values.objective = patch.objective;
  if (patch.geography !== undefined) values.geography = patch.geography;
  if (patch.language !== undefined) values.language = patch.language;
  if (patch.currency !== undefined) values.currency = patch.currency;
  if (patch.constraints !== undefined) values.constraints = JSON.stringify(patch.constraints);
  if (patch.userRequirements !== undefined) {
    values.user_requirements = JSON.stringify(patch.userRequirements);
  }
  if (patch.enabledAgents !== undefined) values.enabled_agents = JSON.stringify(patch.enabledAgents);
  if (patch.currentStage !== undefined) values.current_stage = patch.currentStage;
  if (patch.pendingApprovalStage !== undefined) values.pending_stage = patch.pendingApprovalStage;
  if (patch.decision !== undefined) values.decision = patch.decision;
  if (patch.confidence !== undefined) values.confidence = patch.confidence;
  if (patch.finalReport !== undefined) {
    values.final_report = patch.finalReport ? JSON.stringify(patch.finalReport) : null;
  }
  if (patch.error !== undefined) values.error = patch.error;
  if (patch.startedAt !== undefined) values.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) values.completed_at = patch.completedAt;

  return shapeMission(store.update<MissionRow>('island_missions', id, values, 'Mission'));
}

/** Runs, sources, events and the rest go with it: the island tables all declare
 *  ON DELETE CASCADE from island_missions. */
export function deleteMission(store: TenantStore, id: string): void {
  store.delete('island_missions', id, 'Mission');
}

/** Missions started today, UTC. The daily cap is a spending limit, so the day
 *  boundary is the server's and not the client's. */
export function countMissionsToday(store: TenantStore): number {
  return store.count('island_missions', 'created_at >= @since', {
    since: `${nowIso().slice(0, 10)}T00:00:00.000Z`,
  });
}

// ---------------------------------------------------------------------------
// Agent runs — never overwritten, one row per attempt and per correction round
// ---------------------------------------------------------------------------

export function startRun(
  store: TenantStore,
  missionId: string,
  agentId: string,
  attempt: number,
  round: number,
  envelope: MissionEnvelope,
): AgentRunRecord {
  const row = store.insert<AgentRunRow>('island_agent_runs', {
    id: newId('run'),
    mission_id: missionId,
    agent_id: agentId,
    attempt,
    round,
    status: 'working',
    // The envelope is stored verbatim: without the exact input, a later
    // "why did it say that?" is unanswerable.
    input: JSON.stringify(envelope),
    started_at: nowIso(),
  });
  return shapeRun(row);
}

export interface FinishRunPatch {
  status: AgentState;
  output?: AgentOutput | null;
  notes?: string | null;
  error?: string | null;
  confidence?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export function finishRun(
  store: TenantStore,
  runId: string,
  patch: FinishRunPatch,
): AgentRunRecord {
  const existing = store.findOrFail<AgentRunRow>('island_agent_runs', runId, 'Agent run');
  const completedAt = nowIso();
  const startedAt = new Date(existing.started_at).getTime();

  const values: Record<string, unknown> = {
    status: patch.status,
    completed_at: completedAt,
    duration_ms: Number.isFinite(startedAt)
      ? Math.max(0, new Date(completedAt).getTime() - startedAt)
      : null,
  };
  if (patch.output !== undefined) {
    values.output = patch.output ? JSON.stringify(patch.output) : null;
  }
  if (patch.notes !== undefined) values.notes = patch.notes;
  if (patch.error !== undefined) values.error = patch.error;
  if (patch.confidence !== undefined) values.confidence = patch.confidence;
  if (patch.inputTokens !== undefined) values.input_tokens = patch.inputTokens;
  if (patch.outputTokens !== undefined) values.output_tokens = patch.outputTokens;

  return shapeRun(store.update<AgentRunRow>('island_agent_runs', runId, values, 'Agent run'));
}

/**
 * One run, including the envelope it was given.
 *
 * The list above leaves `input` out because an envelope carries every upstream
 * agent's full output and a mission has dozens of runs. This is the endpoint
 * behind "why did it say that?" — the one question the whole audit trail exists
 * to answer — so it hands back the exact input the agent saw.
 */
export function getRun(store: TenantStore, missionId: string, runId: string): AgentRunRecord {
  const row = store.findOrFail<AgentRunRow>('island_agent_runs', runId, 'Agent run');
  // A run id from another mission is as much a miss as one that does not exist.
  if (row.mission_id !== missionId) throw notFound('Agent run not found.');
  return shapeRun(row);
}

export function listRuns(store: TenantStore, missionId: string): AgentRunRecord[] {
  return store
    .list<AgentRunRow>('island_agent_runs', {
      where: 'mission_id = @missionId',
      params: { missionId },
      orderBy: 'started_at ASC, rowid ASC',
    })
    .map(shapeRun);
}

/**
 * The run that represents each agent's work on this mission.
 *
 * A later attempt supersedes an earlier one, but a failed retry must not hide
 * work an agent had already completed — otherwise a transient API error would
 * erase a finished analysis from the report.
 */
export function latestRunByAgent(
  store: TenantStore,
  missionId: string,
): Record<string, AgentRunRecord> {
  const latest: Record<string, AgentRunRecord> = {};
  for (const run of listRuns(store, missionId)) {
    const current = latest[run.agentId];
    if (!current || run.status === 'completed' || current.status !== 'completed') {
      latest[run.agentId] = run;
    }
  }
  return latest;
}

// ---------------------------------------------------------------------------
// The source register — one shared numbering per mission (S001, S002, ...)
// ---------------------------------------------------------------------------

/**
 * The key two sources are considered the same under.
 *
 * Agents cite the same page with a tracking parameter, a trailing slash or a
 * different scheme, and a register full of near-duplicates makes a citation
 * like "S004" mean nothing. Falls back to the title so a source with no URL
 * still registers exactly once.
 */
function sourceKey(url: string, title: string): string {
  const normalised = normaliseUrl(url);
  if (normalised) return `url:${normalised}`;
  const label = title.trim().toLowerCase();
  return label ? `title:${label}` : '';
}

function normaliseUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(key);
    }
    const host = parsed.host.toLowerCase().replace(/^www\./, '');
    return `${host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    // Not parseable as a URL. Compare it as plain text rather than losing it.
    return raw.toLowerCase().replace(/\/+$/, '');
  }
}

function refNumber(ref: string): number {
  const parsed = Number.parseInt(ref.replace(/^S/i, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceRows(store: TenantStore, missionId: string): SourceRow[] {
  return store.list<SourceRow>('island_sources', {
    where: 'mission_id = @missionId',
    params: { missionId },
    orderBy: 'source_ref ASC',
  });
}

/**
 * Registers the sources an agent actually consulted and hands back the refs it
 * should cite. A source another agent already registered keeps its original
 * ref, so "S002" means the same page to every agent and in the final report.
 */
export function recordSources(
  store: TenantStore,
  missionId: string,
  runId: string,
  agentId: string,
  sources: SourceRecord[],
): SourceRecord[] {
  if (sources.length === 0) return [];

  return store.transaction(() => {
    const known = new Map<string, SourceRecord>();
    let highest = 0;
    for (const row of sourceRows(store, missionId)) {
      known.set(sourceKey(row.url, row.title), shapeSource(row));
      highest = Math.max(highest, refNumber(row.source_ref));
    }

    const registered: SourceRecord[] = [];
    const seen = new Set<string>();
    const createdAt = nowIso();

    for (const source of sources) {
      const url = source.url ?? '';
      const title = source.title ?? '';
      const key = sourceKey(url, title);
      // Neither a URL nor a title is not a source, and repeats inside one
      // agent's list are the same source twice.
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const already = known.get(key);
      if (already) {
        registered.push(already);
        continue;
      }

      highest += 1;
      const row = store.insert<SourceRow>('island_sources', {
        id: newId('src'),
        mission_id: missionId,
        run_id: runId,
        agent_id: agentId,
        source_ref: `S${String(highest).padStart(3, '0')}`,
        title,
        url,
        source_type: source.source_type ?? 'other',
        reliability: source.reliability ?? 'medium',
        created_at: createdAt,
      });
      const record = shapeSource(row);
      known.set(key, record);
      registered.push(record);
    }

    return registered;
  });
}

export function listSources(store: TenantStore, missionId: string): SourceRecord[] {
  return sourceRows(store, missionId).map(shapeSource);
}

// ---------------------------------------------------------------------------
// Verification and corrections — the audit trail behind "no silent fixes"
// ---------------------------------------------------------------------------

export function recordVerifications(
  store: TenantStore,
  missionId: string,
  round: number,
  records: Omit<VerificationRecord, 'id' | 'missionId' | 'createdAt'>[],
): void {
  if (records.length === 0) return;
  const createdAt = nowIso();

  store.transaction(() => {
    for (const record of records) {
      store.insert('island_verifications', {
        id: newId('vrf'),
        mission_id: missionId,
        finding_id: record.findingId,
        agent_id: record.agentId,
        status: record.status,
        reason: record.reason,
        severity: record.severity,
        recommended_action: record.recommendedAction,
        corrected_value: record.correctedValue,
        resolved: record.resolved ? 1 : 0,
        // Which gate round this is belongs to the orchestrator, not to the
        // agent output the records were built from.
        round,
        created_at: createdAt,
      });
    }
  });
}

export function listVerifications(store: TenantStore, missionId: string): VerificationRecord[] {
  return store
    .list<VerificationRow>('island_verifications', {
      where: 'mission_id = @missionId',
      params: { missionId },
      orderBy: 'created_at ASC, rowid ASC',
    })
    .map(shapeVerification);
}

/** Marks every flag against a finding as settled. A finding with no flag is not
 *  an error: an agent may correct work nobody challenged. */
export function resolveVerification(
  store: TenantStore,
  missionId: string,
  findingId: string,
  correctedValue: string,
): void {
  const rows = store.list<{ id: string }>('island_verifications', {
    columns: 'id',
    where: 'mission_id = @missionId AND finding_id = @findingId',
    params: { missionId, findingId },
  });
  for (const row of rows) {
    store.update('island_verifications', row.id, { resolved: 1, corrected_value: correctedValue });
  }
}

export function recordCorrection(
  store: TenantStore,
  missionId: string,
  record: Omit<CorrectionRecord, 'id' | 'missionId' | 'createdAt'>,
): CorrectionRecord {
  const row = store.insert<CorrectionRow>('island_corrections', {
    id: newId('cor'),
    mission_id: missionId,
    finding_id: record.findingId,
    from_agent: record.fromAgent,
    to_agent: record.toAgent,
    original_claim: record.originalClaim,
    corrected_claim: record.correctedClaim,
    reason: record.reason,
    severity: record.severity,
    round: record.round,
    resolved: record.resolved ? 1 : 0,
    created_at: nowIso(),
  });
  return shapeCorrection(row);
}

export function listCorrections(store: TenantStore, missionId: string): CorrectionRecord[] {
  return store
    .list<CorrectionRow>('island_corrections', {
      where: 'mission_id = @missionId',
      params: { missionId },
      orderBy: 'created_at ASC, rowid ASC',
    })
    .map(shapeCorrection);
}

// ---------------------------------------------------------------------------
// The mission timeline
// ---------------------------------------------------------------------------

/**
 * Appends one event to the mission timeline and tells the live bus about it.
 *
 * `seq` is allocated as max + 1 inside a transaction because two agents in the
 * same wave finish whenever they finish, and UNIQUE(mission_id, seq) is what a
 * reconnecting client relies on to replay without gaps or repeats.
 */
export function appendEvent(
  store: TenantStore,
  missionId: string,
  event: {
    type: MissionEventType;
    agentId?: string | null;
    message: string;
    payload?: Record<string, unknown>;
  },
): MissionEvent {
  const row = store.transaction(() => {
    const highest = store.queryOne<{ max_seq: number | null }>(
      `SELECT MAX(seq) AS max_seq FROM island_events
       WHERE merchant_id = @merchantId AND mission_id = @missionId`,
      { missionId },
    );
    return store.insert<EventRow>('island_events', {
      id: newId('evt'),
      mission_id: missionId,
      seq: (highest?.max_seq ?? 0) + 1,
      type: event.type,
      agent_id: event.agentId ?? null,
      message: event.message,
      payload: JSON.stringify(event.payload ?? {}),
      created_at: nowIso(),
    });
  });

  const record = shapeEvent(row);
  // Stored first, published second. A subscriber that reacts by replaying from
  // island_events must never be told about an event the table does not have.
  publish(record);
  return record;
}

export function listEvents(store: TenantStore, missionId: string, afterSeq = 0): MissionEvent[] {
  return store
    .list<EventRow>('island_events', {
      where: 'mission_id = @missionId AND seq > @afterSeq',
      params: { missionId, afterSeq },
      orderBy: 'seq ASC',
    })
    .map(shapeEvent);
}

// ---------------------------------------------------------------------------
// Follow-up questions about a finished mission
// ---------------------------------------------------------------------------

export interface FollowupRecord {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export function addFollowup(
  store: TenantStore,
  missionId: string,
  question: string,
  answer: string,
  askedBy: string | null,
): FollowupRecord {
  const row = store.insert<FollowupRow>('island_followups', {
    id: newId('fup'),
    mission_id: missionId,
    question,
    answer,
    status: 'answered',
    asked_by: askedBy,
    created_at: nowIso(),
  });
  return shapeFollowup(row);
}

export function listFollowups(store: TenantStore, missionId: string): FollowupRecord[] {
  return store
    .list<FollowupRow>('island_followups', {
      where: 'mission_id = @missionId',
      params: { missionId },
      orderBy: 'created_at ASC, rowid ASC',
    })
    .map(shapeFollowup);
}

// ---------------------------------------------------------------------------
// Boot-time reconciliation
// ---------------------------------------------------------------------------

const RESTART_MESSAGE =
  'The server restarted while this mission was still running, so nothing is working on it any more. ' +
  'It has been marked failed rather than left looking active. Start a new mission to pick the work up again.';

/**
 * Closes out missions the last shutdown interrupted.
 *
 * The orchestrator lives in this process: when the process goes, so does every
 * mission in flight. A mission still reading `running` after a restart is a
 * lie the UI would animate forever, so each one is failed with an explanation
 * and its open agent runs are closed with it.
 *
 * This is the one place that uses the global handle rather than a TenantStore.
 * It is platform maintenance across every merchant at boot, before any request
 * has a principal to scope to — not a tenant read.
 */
export function reconcileInterruptedMissions(db: Db = getDb()): void {
  const stranded = db
    .prepare(
      `SELECT id, merchant_id FROM island_missions
       WHERE status IN ('planning', 'running', 'awaiting_approval')`,
    )
    .all() as { id: string; merchant_id: string }[];
  if (stranded.length === 0) return;

  const completedAt = nowIso();
  const failMission = db.prepare(
    `UPDATE island_missions
     SET status = 'failed', error = @error, completed_at = @completedAt, pending_stage = NULL
     WHERE id = @id`,
  );
  const failRuns = db.prepare(
    `UPDATE island_agent_runs
     SET status = 'failed', error = @error, completed_at = @completedAt
     WHERE mission_id = @missionId AND completed_at IS NULL`,
  );
  const nextSeq = db.prepare(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM island_events WHERE mission_id = @missionId`,
  );
  const addEvent = db.prepare(
    `INSERT INTO island_events (id, merchant_id, mission_id, seq, type, agent_id, message, payload, created_at)
     VALUES (@id, @merchant_id, @mission_id, @seq, 'mission_failed', NULL, @message, @payload, @created_at)`,
  );

  db.transaction(() => {
    for (const mission of stranded) {
      failMission.run({ id: mission.id, error: RESTART_MESSAGE, completedAt });
      failRuns.run({ missionId: mission.id, error: RESTART_MESSAGE, completedAt });
      const seq = (nextSeq.get({ missionId: mission.id }) as { seq: number }).seq;
      addEvent.run({
        id: newId('evt'),
        merchant_id: mission.merchant_id,
        mission_id: mission.id,
        seq,
        message: RESTART_MESSAGE,
        payload: JSON.stringify({ reason: 'server_restart' }),
        created_at: completedAt,
      });
    }
  })();
}
