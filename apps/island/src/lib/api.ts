/**
 * Thin API client for the island.
 *
 * Same shape as the merchant CRM client — access token in memory, refresh token
 * persisted, a single transparent refresh-and-replay on a 401 — because the
 * island signs in against the very same merchant account. Only the storage key
 * differs, so having both apps open in one browser does not have them fighting
 * over one slot.
 *
 * The island vocabulary below mirrors server/src/island/types.ts. The two apps
 * are built separately and share no package, so the types are restated here;
 * they must be kept in step with that file, which is the original.
 */
const REFRESH_KEY = 'loyaltyloop.island.refresh';

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setSession(tokens: { accessToken: string; refreshToken: string } | null): void {
  accessToken = tokens?.accessToken ?? null;
  try {
    if (tokens) localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* private browsing — the session simply won't survive a reload */
  }
  listeners.forEach((listener) => listener(Boolean(tokens)));
}

export function onSessionChange(listener: (signedIn: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasStoredSession(): boolean {
  return Boolean(getRefreshToken());
}

async function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  // Collapse concurrent 401s into a single refresh call.
  refreshPromise ??= (async () => {
    try {
      const response = await fetch('/api/auth/merchant/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        setSession(null);
        return false;
      }
      const data = await response.json();
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  retry?: boolean;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 && options.retry !== false) {
    if (await refreshSession()) {
      return api<T>(path, { ...options, retry: false });
    }
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? 'error',
      error.message ?? 'Something went wrong.',
      error.details,
    );
  }
  return payload as T;
}

/** Restores a session from the stored refresh token on app start. */
export async function restoreSession(): Promise<boolean> {
  if (accessToken) return true;
  return refreshSession();
}

/** The one sentence to put in front of the user when a call fails. */
export function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (Array.isArray(caught.details) && caught.details.length > 0) {
      const first = caught.details[0] as { field?: string; message?: string };
      return first.message ? `${first.field ? `${first.field}: ` : ''}${first.message}` : caught.message;
    }
    return caught.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}

// --- authentication ---------------------------------------------------------

export interface MerchantUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'manager' | 'staff';
}

export interface MerchantProfile {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  currency: string;
  country: string;
}

export interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  user: MerchantUser;
  merchant: MerchantProfile;
}

export async function signIn(email: string, password: string): Promise<SessionPayload> {
  const data = await api<SessionPayload>('/auth/merchant/login', {
    method: 'POST',
    body: { email, password },
    retry: false,
  });
  setSession(data);
  return data;
}

export async function signOut(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await api('/auth/merchant/logout', { method: 'POST', body: { refreshToken } }).catch(() => {});
  }
  setSession(null);
}

export async function fetchMe(): Promise<{ user: MerchantUser; merchant: MerchantProfile }> {
  return api<{ user: MerchantUser; merchant: MerchantProfile }>('/auth/merchant/me');
}

// --- island vocabulary ------------------------------------------------------

export type Label = 'VERIFIED' | 'ESTIMATE' | 'NEEDS_VERIFICATION' | 'HIGH_RISK';
export type Severity = 'low' | 'medium' | 'high';
export type Importance = 'low' | 'medium' | 'high';
export type Reliability = 'high' | 'medium' | 'low';
export type SourceType = 'official' | 'news' | 'research' | 'company' | 'social' | 'other';
export type Decision = 'proceed' | 'proceed_with_caution' | 'more_research' | 'do_not_proceed';
export type MissionMode = 'auto' | 'approval';
export type EngineKind = 'claude' | 'simulation';

export type MissionStatus =
  | 'created'
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'aborted';

export type AgentState =
  | 'waiting'
  | 'queued'
  | 'working'
  | 'completed'
  | 'failed'
  | 'needs_review'
  | 'retrying'
  | 'blocked'
  | 'skipped';

export type Stage = 'plan' | 'gather' | 'analyse' | 'verify' | 'quantify' | 'strategise' | 'review';

export interface Evidence {
  source_id: string;
  source_title: string;
  source_url: string;
  support: string;
}

export interface Finding {
  finding_id: string;
  claim: string;
  category: string;
  importance: Importance;
  label: Label;
  evidence: Evidence[];
  confidence: number;
}

export interface Issue {
  issue_id: string;
  target_agent: string;
  target_finding_id: string;
  problem: string;
  severity: Severity;
  required_action: string;
}

export interface Recommendation {
  priority: number;
  action: string;
  reason: string;
}

export interface SourceRecord {
  source_id: string;
  title: string;
  url: string;
  source_type: SourceType;
  reliability: Reliability;
}

export interface CorrectionIssue {
  issue_id: string;
  agent: string;
  finding_id: string;
  problem: string;
  severity: Severity;
  required_action: string;
}

/** The core envelope every agent returns, plus whatever its own schema adds. */
export type AgentOutput = {
  mission_id: string;
  agent: string;
  status: 'completed' | 'corrected' | 'failed';
  findings: Finding[];
  evidence: Evidence[];
  issues: Issue[];
  assumptions: string[];
  recommendations: Recommendation[];
  next_agent_instructions: string;
  confidence: number;
} & Record<string, unknown>;

export interface AgentDefinition {
  id: string;
  name: string;
  emoji: string;
  role: string;
  stage: Stage;
  dependsOn: string[];
  core: boolean;
  enabledByDefault: boolean;
  webSearch: boolean;
  backupAgentId?: string;
  systemPrompt: string;
  map: { x: number; y: number };
  summary: string;
}

export interface RosterEntry {
  definition: AgentDefinition;
  enabled: boolean;
}

export interface AgentRunRecord {
  id: string;
  missionId: string;
  agentId: string;
  attempt: number;
  round: number;
  status: AgentState;
  /** The envelope the agent was handed. Kept opaque here — the UI shows it raw. */
  input: Record<string, unknown> | null;
  output: AgentOutput | null;
  error: string | null;
  confidence: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  notes: string | null;
}

export interface MissionRecord {
  id: string;
  reference: string;
  merchantId: string;
  userTask: string;
  objective: string;
  geography: string;
  language: string;
  currency: string;
  constraints: string[];
  userRequirements: string[];
  status: MissionStatus;
  mode: MissionMode;
  engine: EngineKind;
  enabledAgents: string[];
  currentStage: Stage | null;
  pendingApprovalStage: Stage | null;
  decision: Decision | null;
  confidence: number | null;
  finalReport: FinalReport | null;
  error: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CorrectionRecord {
  id: string;
  missionId: string;
  findingId: string;
  fromAgent: string;
  toAgent: string;
  originalClaim: string;
  correctedClaim: string;
  reason: string;
  severity: Severity;
  round: number;
  resolved: boolean;
  createdAt: string;
}

export interface VerificationRecord {
  id: string;
  missionId: string;
  findingId: string;
  agentId: string;
  status: 'verified' | 'needs_verification' | 'contradiction' | 'high_risk';
  reason: string;
  severity: Severity;
  recommendedAction: string;
  correctedValue: string;
  resolved: boolean;
  round: number;
  createdAt: string;
}

export type MissionEventType =
  | 'mission_created'
  | 'mission_started'
  | 'stage_started'
  | 'agent_queued'
  | 'agent_started'
  | 'agent_progress'
  | 'agent_completed'
  | 'agent_failed'
  | 'agent_retrying'
  | 'agent_skipped'
  | 'handoff'
  | 'challenge'
  | 'correction_requested'
  | 'correction_applied'
  | 'verification_result'
  | 'approval_required'
  | 'approval_granted'
  | 'mission_paused'
  | 'mission_resumed'
  | 'mission_completed'
  | 'mission_failed'
  | 'mission_aborted'
  | 'log';

export interface MissionEvent {
  id: string;
  missionId: string;
  seq: number;
  type: MissionEventType;
  agentId: string | null;
  payload: Record<string, unknown>;
  message: string;
  createdAt: string;
}

export interface ReportKeyFinding {
  finding: string;
  evidence: string[];
  label: Label;
  confidence: number;
}

export interface FinalReport {
  mission_id: string;
  mission_reference: string;
  generated_at: string;
  engine: EngineKind;
  original_task: string;
  executive_summary: string;
  key_findings: ReportKeyFinding[];
  research_summary: string;
  competitor_summary: string;
  market_summary: string;
  analysis_summary: string;
  financial_summary: {
    estimated_startup_cost: number;
    estimated_monthly_cost: number;
    estimated_monthly_revenue: number;
    currency: string;
    note: string;
  };
  major_risks: string[];
  verification: {
    total_claims_reviewed: number;
    verified: number;
    needs_verification: number;
    contradictions: number;
    high_risk_items: number;
    rounds_used: number;
    passed: boolean;
  };
  strategy_summary: string;
  recommendation: { decision: Decision; reason: string };
  action_plan: Recommendation[];
  assumptions: string[];
  unresolved_questions: string[];
  unresolved_issues: CorrectionIssue[];
  corrections: CorrectionRecord[];
  sources: SourceRecord[];
  overall_confidence: number;
  confidence_explanation: string;
  agent_summary: { agent: string; name: string; status: string; key_contribution: string }[];
  simulation_notice: string;
  /** Where assembly overruled an agent because the record did not back it. */
  integrity_notes: string[];
}

export interface Followup {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

/** Everything a mission page needs, in one call. */
export interface MissionPackage {
  mission: MissionRecord;
  runs: AgentRunRecord[];
  events: MissionEvent[];
  sources: SourceRecord[];
  verifications: VerificationRecord[];
  corrections: CorrectionRecord[];
  followups: Followup[];
  roster: RosterEntry[];
}

export interface RosterResponse {
  agents: RosterEntry[];
  engine: EngineKind;
  engineLabel: string;
  /** True when no live model will run. Every surface must say so, loudly. */
  simulation: boolean;
}

// --- island calls -----------------------------------------------------------

/**
 * The roster, plus which engine is actually behind it.
 *
 * The engine fields are filled in defensively: if the server ever stops sending
 * `simulation`, this must fall back to warning the user rather than to silence.
 * A simulated run that looks like research is the one failure this whole system
 * exists to prevent.
 */
export async function fetchRoster(): Promise<RosterResponse> {
  const payload = await api<Partial<RosterResponse> & { roster?: RosterEntry[] }>('/island/agents');
  const engine: EngineKind = payload.engine ?? 'simulation';
  return {
    agents: payload.agents ?? payload.roster ?? [],
    engine,
    engineLabel: payload.engineLabel ?? (engine === 'claude' ? 'Claude' : 'Simulation'),
    simulation: payload.simulation ?? engine !== 'claude',
  };
}

export async function setAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
  await api(`/island/agents/${encodeURIComponent(agentId)}`, { method: 'PATCH', body: { enabled } });
}

export async function listMissions(
  options: { limit?: number; offset?: number; status?: MissionStatus | 'all' } = {},
): Promise<{ missions: MissionRecord[]; total: number }> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.offset) query.set('offset', String(options.offset));
  if (options.status && options.status !== 'all') query.set('status', options.status);
  const suffix = query.toString();
  return api<{ missions: MissionRecord[]; total: number }>(
    `/island/missions${suffix ? `?${suffix}` : ''}`,
  );
}

export interface CreateMissionInput {
  task: string;
  objective?: string;
  geography?: string;
  currency?: string;
  constraints?: string[];
  agents?: string[];
  mode?: MissionMode;
  start?: boolean;
}

/** Single records come back wrapped as `{ mission }`; a bare record also works. */
function asMission(payload: unknown): MissionRecord {
  const body = payload as { mission?: MissionRecord };
  return body.mission ?? (payload as MissionRecord);
}

export async function createMission(input: CreateMissionInput): Promise<MissionRecord> {
  return asMission(await api('/island/missions', { method: 'POST', body: input }));
}

export async function fetchMission(missionId: string): Promise<MissionPackage> {
  return api<MissionPackage>(`/island/missions/${encodeURIComponent(missionId)}`);
}

/**
 * One agent run with the exact envelope it was handed.
 *
 * Fetched on demand rather than arriving with the mission: an envelope carries
 * every upstream agent's full output, and a mission has dozens of runs. This is
 * what turns "the island concluded X" into "this agent concluded X, having been
 * shown exactly this".
 */
export async function fetchRunEnvelope(
  missionId: string,
  runId: string,
): Promise<Record<string, unknown>> {
  const response = await api<{ run: AgentRunRecord }>(
    `/island/missions/${encodeURIComponent(missionId)}/runs/${encodeURIComponent(runId)}`,
  );
  return response.run.input ?? {};
}

export async function fetchReport(missionId: string): Promise<FinalReport> {
  const response = await api<{ report: FinalReport }>(
    `/island/missions/${encodeURIComponent(missionId)}/report`,
  );
  return response.report;
}

export type MissionCommand = 'pause' | 'resume' | 'abort' | 'approve';

export async function commandMission(
  missionId: string,
  command: MissionCommand,
  note?: string,
): Promise<MissionRecord> {
  return asMission(
    await api(`/island/missions/${encodeURIComponent(missionId)}/${command}`, {
      method: 'POST',
      body: note ? { note } : {},
    }),
  );
}

export async function askFollowup(missionId: string, question: string): Promise<string> {
  const response = await api<{ answer: string }>(
    `/island/missions/${encodeURIComponent(missionId)}/followups`,
    { method: 'POST', body: { question } },
  );
  return response.answer;
}

export async function deleteMission(missionId: string): Promise<void> {
  await api(`/island/missions/${encodeURIComponent(missionId)}`, { method: 'DELETE' });
}

/**
 * Saves the mission report as a markdown file.
 *
 * A plain <a href> cannot carry the bearer token, so the file comes back through
 * the same client (refresh-on-401 included) and is handed to the browser as an
 * object URL.
 */
export async function downloadReportMarkdown(missionId: string, filename: string): Promise<void> {
  const path = `/island/missions/${encodeURIComponent(missionId)}/report?format=markdown`;

  const request = async (retry: boolean): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'text/markdown' };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const response = await fetch(`/api${path}`, { headers });
    if (response.status === 401 && retry && (await refreshSession())) return request(false);
    return response;
  };

  const response = await request(true);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'error',
      payload?.error?.message ?? 'Could not download the report.',
    );
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously cancels the download before the browser has read the
  // blob, so hand the object URL back on a later tick instead.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// --- the live mission stream ------------------------------------------------

export interface MissionStreamHandlers {
  onEvent: (event: MissionEvent) => void;
  /** Called every time the stream is (re)established. */
  onOpen?: () => void;
  /** Called with something showable when the stream drops or gives up. */
  onError?: (message: string) => void;
}

/** SSE frames are separated by a blank line, which may be CRLF-delimited. */
const FRAME_BOUNDARY = /\r?\n\r?\n/;

/**
 * Subscribes to a mission's live events. Returns the cancel function.
 *
 * Built on fetch and a stream reader rather than EventSource, deliberately:
 * EventSource cannot send an Authorization header, and the alternative — a
 * token in the query string — would leak a credential into proxy logs, server
 * logs and browser history. That means parsing the SSE framing here, which is
 * a few lines, and reconnecting by hand, which we want anyway: on a dropped
 * connection we resume from the last seq we saw, so no event is lost while the
 * mission carries on running on the server.
 */
export function openMissionStream(missionId: string, handlers: MissionStreamHandlers): () => void {
  let cancelled = false;
  /** Set when the server closes the stream on purpose, so we do not reconnect. */
  let finished = false;
  let lastSeq = 0;
  let attempt = 0;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;

  function url(): string {
    return `/api/island/missions/${encodeURIComponent(missionId)}/stream?afterSeq=${lastSeq}`;
  }

  async function open(signal: AbortSignal, retry = true): Promise<Response> {
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    // Resuming by seq covers the reconnect; Last-Event-ID is sent as well so the
    // server can honour whichever it prefers.
    if (lastSeq > 0) headers['last-event-id'] = String(lastSeq);
    const response = await fetch(url(), { headers, signal, cache: 'no-store' });
    if (response.status === 401 && retry && (await refreshSession())) return open(signal, false);
    return response;
  }

  function handleFrame(frame: string): void {
    const data: string[] = [];
    let name = '';
    for (const line of frame.split(/\r?\n/)) {
      // A line that starts with a colon is a comment — the server sends one
      // every 25 seconds so an idle stream is not closed by a proxy.
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'data') data.push(value);
      else if (field === 'event') name = value;
      else if (field === 'id') {
        const seq = Number(value);
        if (Number.isFinite(seq)) lastSeq = Math.max(lastSeq, seq);
      }
    }
    if (data.length === 0) return;

    // The route frames two things that are not mission events: `stream_open`
    // describes the connection, and `stream_end` says the server is closing on
    // purpose. Their payloads have no `seq` or `type`, so they have to be caught
    // by name here — passed on as events they would land in the timeline as
    // blank rows, and an intentional close would be read as a dropped one and
    // reconnected against a mission that has already finished.
    if (name === 'stream_open') return;
    if (name === 'stream_end') {
      finished = true;
      let reason = '';
      try {
        reason = String((JSON.parse(data.join('\n')) as { reason?: unknown }).reason ?? '');
      } catch {
        /* an unreadable reason still means the server is done talking */
      }
      // `mission_finished` is the ordinary ending — the mission is over and the
      // page already has every event. Anything else is the server giving up.
      if (reason !== 'mission_finished') {
        handlers.onError?.('The mission feed closed unexpectedly. Reload the page to pick it back up.');
      }
      return;
    }

    let event: MissionEvent;
    try {
      event = JSON.parse(data.join('\n')) as MissionEvent;
    } catch {
      return; // A frame we cannot read is not worth tearing the stream down for.
    }
    if (typeof event.seq === 'number') lastSeq = Math.max(lastSeq, event.seq);
    handlers.onEvent(event);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(() => {
        timer = null;
        wake = null;
        resolve();
      }, ms);
    });
  }

  async function run(): Promise<void> {
    while (!cancelled && !finished) {
      controller = new AbortController();
      try {
        const response = await open(controller.signal);

        if (response.status >= 400 && response.status < 500) {
          // A 4xx is about this request — the mission is gone, or this account
          // may not read it — so reconnecting would only repeat it.
          const payload = await response.json().catch(() => ({}));
          handlers.onError?.(payload?.error?.message ?? 'This mission stream is not available.');
          return;
        }
        if (!response.ok || !response.body) throw new Error(`stream responded ${response.status}`);

        attempt = 0;
        handlers.onOpen?.();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary = FRAME_BOUNDARY.exec(buffer);
          while (boundary) {
            const frame = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            handleFrame(frame);
            boundary = FRAME_BOUNDARY.exec(buffer);
          }
        }
      } catch {
        /* falls through to the backoff below */
      }

      // A stream the server ended deliberately is not a dropped one: reporting
      // it would put a warning on screen at the exact moment a mission succeeds.
      if (cancelled || finished) return;
      handlers.onError?.('Lost the live connection to the mission. Reconnecting…');
      attempt += 1;
      await sleep(Math.min(15_000, 500 * 2 ** attempt) + Math.random() * 250);
    }
  }

  void run();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    const resume = wake;
    wake = null;
    // Wake the backoff so the loop can notice it has been cancelled and stop,
    // rather than leaving a timer and a pending promise behind.
    resume?.();
    controller?.abort();
  };
}
