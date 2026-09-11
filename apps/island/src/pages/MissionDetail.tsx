import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  askFollowup,
  commandMission,
  describeError,
  downloadReportMarkdown,
  fetchMission,
  fetchRunEnvelope,
  openMissionStream,
  type AgentDefinition,
  type AgentRunRecord,
  type AgentState,
  type Finding,
  type FinalReport,
  type MissionCommand,
  type MissionEvent,
  type MissionEventType,
  type MissionPackage,
} from '../lib/api';
import { canAct, useSession } from '../lib/session';
import {
  AgentStatePill,
  ConfidenceMeter,
  DECISION_LABEL,
  DECISION_TONE,
  Empty,
  ErrorNote,
  LabelChip,
  Loading,
  STAGE_LABEL,
  STAGE_ORDER,
  Stat,
  StatusPill,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatTime,
} from '../components/ui';
import { Island } from '../components/Island';

/** Statuses where the mission is still moving, and worth holding a stream open for. */
const LIVE = new Set(['created', 'planning', 'running', 'awaiting_approval', 'paused']);

/** Events that change stored data, not just the narration, so the page refetches. */
const RELOAD_ON = new Set<MissionEventType>([
  'stage_started',
  'agent_completed',
  'agent_failed',
  'agent_skipped',
  'challenge',
  'correction_requested',
  'correction_applied',
  'verification_result',
  'approval_required',
  'approval_granted',
  'mission_paused',
  'mission_resumed',
  'mission_completed',
  'mission_failed',
  'mission_aborted',
]);

const EVENT_STATE: Partial<Record<MissionEventType, AgentState>> = {
  agent_queued: 'queued',
  agent_started: 'working',
  agent_completed: 'completed',
  agent_failed: 'failed',
  agent_retrying: 'retrying',
  agent_skipped: 'skipped',
};

const TIMELINE_TONE: Partial<Record<MissionEventType, 'agent' | 'alert' | 'good'>> = {
  agent_queued: 'agent',
  agent_started: 'agent',
  agent_progress: 'agent',
  handoff: 'agent',
  agent_completed: 'good',
  mission_completed: 'good',
  approval_granted: 'good',
  correction_applied: 'good',
  agent_failed: 'alert',
  agent_retrying: 'alert',
  challenge: 'alert',
  correction_requested: 'alert',
  verification_result: 'alert',
  approval_required: 'alert',
  mission_failed: 'alert',
  mission_aborted: 'alert',
};

/** Fields every agent returns; anything else came from that agent's own schema. */
const CORE_OUTPUT_KEYS = new Set([
  'mission_id',
  'agent',
  'status',
  'findings',
  'evidence',
  'issues',
  'assumptions',
  'recommendations',
  'next_agent_instructions',
  'confidence',
]);

function humanise(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function mergeEvents(current: MissionEvent[], incoming: MissionEvent[]): MissionEvent[] {
  const seen = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) seen.set(event.id, event);
  return [...seen.values()].sort((a, b) => a.seq - b.seq);
}

export function MissionDetail() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const mayControl = canAct(user.role, 'manager');

  const [pkg, setPkg] = useState<MissionPackage | null>(null);
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streamNote, setStreamNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const next = await fetchMission(id);
      setPkg(next);
      setEvents((current) => mergeEvents(current, next.events));
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [id]);

  const scheduleRefresh = useCallback(() => {
    // A burst of events at the end of a wave should cost one refetch, not six.
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 600);
  }, [refresh]);

  useEffect(() => {
    setPkg(null);
    setEvents([]);
    setError(null);
    void refresh();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    };
  }, [refresh]);

  const mission = pkg?.mission ?? null;
  const live = mission ? LIVE.has(mission.status) : false;

  useEffect(() => {
    if (!id || !live) return undefined;
    setStreamNote(null);
    return openMissionStream(id, {
      onOpen: () => setStreamNote(null),
      onError: (message) => setStreamNote(message),
      onEvent: (event) => {
        setEvents((current) =>
          current.some((existing) => existing.id === event.id)
            ? current
            : [...current, event].sort((a, b) => a.seq - b.seq),
        );
        if (RELOAD_ON.has(event.type)) scheduleRefresh();
      },
    });
  }, [id, live, scheduleRefresh]);

  const agents = useMemo<AgentDefinition[]>(() => {
    if (!pkg) return [];
    const wanted = new Set(pkg.mission.enabledAgents);
    const sailing = pkg.roster.filter((entry) => wanted.has(entry.definition.id));
    const entries = sailing.length > 0 ? sailing : pkg.roster.filter((entry) => entry.enabled);
    return entries.map((entry) => entry.definition);
  }, [pkg]);

  /** The most recent run per agent: a retry and a correction round are separate rows. */
  const runs = useMemo(() => {
    const map = new Map<string, AgentRunRecord>();
    for (const run of pkg?.runs ?? []) {
      const current = map.get(run.agentId);
      if (!current || run.startedAt >= current.startedAt) map.set(run.agentId, run);
    }
    return map;
  }, [pkg]);

  const states = useMemo(() => {
    const map: Record<string, AgentState> = {};
    for (const definition of agents) map[definition.id] = 'waiting';
    for (const [agentId, run] of runs) map[agentId] = run.status;
    // Events arrive live where the stored runs are one refetch behind, so they win.
    for (const event of events) {
      const next = EVENT_STATE[event.type];
      if (next && event.agentId) map[event.agentId] = next;
    }
    return map;
  }, [agents, runs, events]);

  const working = agents.filter((definition) => states[definition.id] === 'working');
  const completedCount = agents.filter((definition) => states[definition.id] === 'completed').length;
  const progress = agents.length === 0 ? 0 : Math.round((completedCount / agents.length) * 100);

  const activeTransfer = useMemo(() => {
    const target = working[0]?.id;
    if (!target) return null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event) continue;
      if (event.type === 'handoff' && textOf(event.payload.to) === target) {
        const from = textOf(event.payload.from) ?? event.agentId;
        if (from) return { from, to: target };
      }
      // No hand-off announced yet: the packet still came from whoever just finished.
      if (event.type === 'agent_completed' && event.agentId && event.agentId !== target) {
        return { from: event.agentId, to: target };
      }
    }
    return null;
  }, [events, working]);

  const verification = useMemo(() => {
    const records = pkg?.verifications ?? [];
    const unresolved = records.filter((record) => !record.resolved);
    const output = runs.get('risk_verification')?.output;
    const passed = typeof output?.verification_passed === 'boolean' ? output.verification_passed : null;
    return { unresolved, passed, rounds: Math.max(0, ...records.map((record) => record.round)) };
  }, [pkg, runs]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    for (const definition of agents) {
      const state = states[definition.id];
      if (state === 'failed') out.push(`${definition.name} failed; the mission continued without it.`);
      if (state === 'retrying') out.push(`${definition.name} is retrying after an unusable response.`);
      if (state === 'needs_review') out.push(`${definition.name} produced work that needs a human read.`);
    }
    for (const record of verification.unresolved) {
      if (record.severity === 'high') {
        out.push(`Unresolved high-severity flag on ${record.findingId}: ${record.reason}`);
      }
    }
    for (const correction of pkg?.corrections ?? []) {
      if (!correction.resolved) {
        out.push(`Open challenge — ${correction.fromAgent} → ${correction.toAgent}: ${correction.reason}`);
      }
    }
    return out;
  }, [agents, states, verification, pkg]);

  async function command(action: MissionCommand) {
    if (action === 'abort' && !confirm('Stop this mission? Work already done is kept.')) return;
    setBusy(action);
    setError(null);
    try {
      const next = await commandMission(id, action);
      setPkg((current) => (current ? { ...current, mission: next } : current));
      scheduleRefresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    if (!mission) return;
    setBusy('download');
    setError(null);
    try {
      await downloadReportMarkdown(id, `${mission.reference}.md`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || asking) return;
    setAsking(true);
    setError(null);
    try {
      await askFollowup(id, question.trim());
      setQuestion('');
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setAsking(false);
    }
  }

  if (error && !pkg) return <ErrorNote message={error} onRetry={() => void refresh()} />;
  if (!pkg || !mission) return <Loading rows={4} />;

  const report = mission.finalReport;
  const firstWorking = working[0];
  const currentAgent = !firstWorking
    ? '—'
    : working.length === 1
      ? firstWorking.name
      : `${working.length} agents`;

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <div className="row row--between row--wrap row--top">
          <div className="page-head">
            <div className="row row--wrap" style={{ gap: 8 }}>
              <span className="mission-item__ref">{mission.reference}</span>
              <StatusPill status={mission.status} />
              {live ? (
                <span className={`pill ${streamNote ? 'pill--warning' : 'pill--positive'}`}>
                  {streamNote ? 'Reconnecting' : 'Live'}
                </span>
              ) : null}
            </div>
            <h1 className="page-head__title">{mission.userTask}</h1>
            <p className="page-head__sub">
              Started {formatDateTime(mission.startedAt ?? mission.createdAt)} by{' '}
              {mission.createdByName || 'someone'} ·{' '}
              {mission.mode === 'approval' ? 'approval gates' : 'automatic'}
              {mission.geography ? ` · ${mission.geography}` : ''}
              {mission.currency ? ` · ${mission.currency}` : ''}
            </p>
          </div>

          <div className="row row--wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
            {mayControl && (mission.status === 'running' || mission.status === 'planning') ? (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => command('pause')} disabled={busy !== null}>
                {busy === 'pause' ? 'Pausing…' : 'Pause'}
              </button>
            ) : null}
            {mayControl && mission.status === 'paused' ? (
              <button type="button" className="btn btn--sm" onClick={() => command('resume')} disabled={busy !== null}>
                {busy === 'resume' ? 'Resuming…' : 'Resume'}
              </button>
            ) : null}
            {mayControl && live ? (
              <button type="button" className="btn btn--sm btn--danger" onClick={() => command('abort')} disabled={busy !== null}>
                Abort
              </button>
            ) : null}
            {report ? (
              <button type="button" className="btn btn--sm btn--ghost" onClick={download} disabled={busy !== null}>
                {busy === 'download' ? 'Preparing…' : 'Download markdown'}
              </button>
            ) : null}
            <Link className="btn btn--sm btn--subtle" to="/missions">
              All missions
            </Link>
          </div>
        </div>

        {mission.objective ? <p className="small" style={{ margin: 0 }}>{mission.objective}</p> : null}

        {mission.engine === 'simulation' ? (
          <div className="sim-notice" role="alert">
            <span aria-hidden="true">⚠️</span>
            <div className="stack stack--sm">
              <strong>This mission ran on the simulation engine. It is not research.</strong>
              <span>
                No model was called and no source was read. Every finding below is a placeholder
                produced to demonstrate the pipeline, labelled NEEDS_VERIFICATION with no evidence
                behind it.
              </span>
            </div>
          </div>
        ) : null}

        {mission.status === 'awaiting_approval' ? (
          <div className="alert alert--warning row row--between row--wrap" role="alert">
            <span>
              {mission.pendingApprovalStage
                ? `${STAGE_LABEL[mission.pendingApprovalStage]} is finished and waiting for you.`
                : 'The island is waiting for your approval before it continues.'}
            </span>
            {mayControl ? (
              <button type="button" className="btn btn--sm" onClick={() => command('approve')} disabled={busy !== null}>
                {busy === 'approve' ? 'Approving…' : 'Approve and continue'}
              </button>
            ) : (
              <span className="small">A manager or owner has to approve this.</span>
            )}
          </div>
        ) : null}

        {error ? <ErrorNote message={error} /> : null}
        {mission.error ? <ErrorNote message={mission.error} /> : null}
      </div>

      <StageRail agents={agents} states={states} currentStage={mission.currentStage} />

      <div className="grid grid--4">
        <Stat
          label="Working now"
          value={currentAgent}
          note={
            firstWorking
              ? working.map((definition) => definition.name).join(', ')
              : mission.status === 'completed'
                ? 'Mission finished'
                : 'Nobody is working'
          }
        />
        <Stat
          label="Completed"
          value={`${completedCount}/${agents.length}`}
          note={`${agents.length - completedCount} still to run`}
        />
        <Stat
          label="Progress"
          value={`${progress}%`}
          note={mission.currentStage ? STAGE_LABEL[mission.currentStage] : 'Not started'}
        />
        <Stat
          label="Verification"
          value={verification.passed === null ? 'Pending' : verification.passed ? 'Passed' : 'Failed'}
          note={`${verification.unresolved.length} unresolved · ${verification.rounds} round${verification.rounds === 1 ? '' : 's'}`}
          tone={verification.passed === false ? 'negative' : verification.passed ? 'positive' : undefined}
        />
      </div>

      <div className="card stack">
        <div className="bar" aria-hidden="true">
          <div className="bar__fill" style={{ width: `${progress}%` }} />
        </div>
        {warnings.length > 0 ? (
          <div className="stack stack--sm">
            <span className="strong small">Warnings ({warnings.length})</span>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>No warnings raised so far.</p>
        )}
        {streamNote ? <p className="launch__hint" style={{ margin: 0 }}>{streamNote}</p> : null}
      </div>

      <section className="card stack">
        <div className="row row--between row--wrap">
          <h2 className="report__heading">The island</h2>
          <span className="launch__hint">
            {activeTransfer
              ? `Handing off: ${activeTransfer.from} → ${activeTransfer.to}`
              : 'Tap a hut to open that agent’s work.'}
          </span>
        </div>
        <Island
          agents={agents}
          states={states}
          activeTransfer={activeTransfer}
          onSelect={(agentId) => {
            setSelected((current) => (current === agentId ? null : agentId));
            setOpen((current) => ({ ...current, [agentId]: !current[agentId] }));
          }}
          selected={selected}
        />
      </section>

      <section className="stack">
        <h2 className="report__heading">What each agent found</h2>
        {agents.map((definition) => (
          <AgentPanel
            key={definition.id}
            definition={definition}
            run={runs.get(definition.id) ?? null}
            state={states[definition.id] ?? 'waiting'}
            open={open[definition.id] === true}
            highlighted={selected === definition.id}
            onToggle={() => setOpen((current) => ({ ...current, [definition.id]: !current[definition.id] }))}
          />
        ))}
      </section>

      <div className="split split--even">
        <Timeline events={events} agents={agents} />
        <AuditTrail pkg={pkg} />
      </div>

      <VerificationPanel pkg={pkg} passed={verification.passed} />

      <SourceRegister pkg={pkg} />

      {report ? <ReportView report={report} /> : null}

      {mission.status === 'completed' ? (
        <section className="card stack">
          <h2 className="report__heading">Ask a follow-up</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Answered strictly from this mission's own findings and sources. If the answer is not in
            the package you will be told so, not guessed at.
          </p>

          {pkg.followups.map((followup) => (
            <div key={followup.id} className="source-item">
              <span className="source-ref" aria-hidden="true">💬</span>
              <div className="grow">
                <div className="strong small">{followup.question}</div>
                <p className="prose" style={{ marginTop: 4 }}>{followup.answer}</p>
                <div className="source-meta">{formatDateTime(followup.createdAt)}</div>
              </div>
            </div>
          ))}

          <form className="row" onSubmit={ask}>
            <input
              className="input grow"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What would change this recommendation?"
              aria-label="Ask a follow-up question about this mission"
            />
            <button className="btn btn--sm" type="submit" disabled={asking || !question.trim()}>
              {asking ? 'Asking…' : 'Ask'}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

// --- progress ---------------------------------------------------------------

function StageRail({
  agents,
  states,
  currentStage,
}: {
  agents: AgentDefinition[];
  states: Record<string, AgentState>;
  currentStage: string | null;
}) {
  const stages = STAGE_ORDER.filter((stage) => agents.some((definition) => definition.stage === stage));
  if (stages.length === 0) return null;

  return (
    <div className="stage-rail">
      {stages.map((stage) => {
        const members = agents.filter((definition) => definition.stage === stage);
        const done = members.every((definition) => {
          const state = states[definition.id];
          return state === 'completed' || state === 'skipped' || state === 'failed';
        });
        const mark = currentStage === stage ? 'is-current' : done ? 'is-done' : '';
        return (
          <span key={stage} className={`stage-rail__step ${mark}`}>
            <span className="stage-rail__dot" />
            {STAGE_LABEL[stage]}
          </span>
        );
      })}
    </div>
  );
}

// --- agent work -------------------------------------------------------------

function AgentPanel({
  definition,
  run,
  state,
  open,
  highlighted,
  onToggle,
}: {
  definition: AgentDefinition;
  run: AgentRunRecord | null;
  state: AgentState;
  open: boolean;
  highlighted: boolean;
  onToggle: () => void;
}) {
  const output = run?.output ?? null;
  const findings = output?.findings ?? [];
  const extras = output ? Object.entries(output).filter(([key]) => !CORE_OUTPUT_KEYS.has(key)) : [];

  return (
    <article className={`agent-card ${highlighted ? 'is-selected' : ''}`}>
      <button
        type="button"
        className="agent-card__head"
        onClick={onToggle}
        aria-expanded={open}
        style={{ background: 'none', border: 0, padding: 0, width: '100%', textAlign: 'left' }}
      >
        <span className="agent-card__emoji" aria-hidden="true">{definition.emoji}</span>
        <span className="grow">
          <span className="agent-card__name">{definition.name}</span>
          <span className="agent-card__role">
            {definition.role} · {STAGE_LABEL[definition.stage]}
            {run && run.attempt > 1 ? ` · attempt ${run.attempt}` : ''}
            {run && run.round > 0 ? ` · correction round ${run.round}` : ''}
          </span>
        </span>
        <AgentStatePill state={state} />
        <span aria-hidden="true" className="muted">{open ? '▾' : '▸'}</span>
      </button>

      {run?.confidence !== null && run?.confidence !== undefined ? (
        <ConfidenceMeter value={run.confidence} label="Agent confidence" />
      ) : null}

      {open ? (
        <div className="stack">
          {!run ? <p className="agent-card__body">This agent has not run yet.</p> : null}
          {run?.error ? <ErrorNote message={run.error} /> : null}

          {findings.length > 0 ? (
            <div className="stack stack--sm">
              <span className="strong small">Findings</span>
              {findings.map((finding) => (
                <FindingRow key={finding.finding_id} finding={finding} />
              ))}
            </div>
          ) : null}

          {output && output.issues.length > 0 ? (
            <div className="stack stack--sm">
              <span className="strong small">Issues it raised</span>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {output.issues.map((issue) => (
                  <li key={issue.issue_id}>
                    <span className={`pill pill--${issue.severity === 'high' ? 'negative' : 'warning'}`}>
                      {issue.severity}
                    </span>{' '}
                    <strong>{issue.target_agent || 'own caveat'}</strong>
                    {issue.target_finding_id ? ` (${issue.target_finding_id})` : ''}: {issue.problem}
                    <div className="source-meta">Required: {issue.required_action}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {output && output.recommendations.length > 0 ? (
            <div className="stack stack--sm">
              <span className="strong small">Recommendations</span>
              <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {[...output.recommendations]
                  .sort((a, b) => a.priority - b.priority)
                  .map((recommendation, index) => (
                    <li key={index}>
                      <strong>{recommendation.action}</strong>
                      <div className="source-meta">{recommendation.reason}</div>
                    </li>
                  ))}
              </ol>
            </div>
          ) : null}

          {output && output.assumptions.length > 0 ? (
            <div className="stack stack--sm">
              <span className="strong small">Assumptions</span>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {output.assumptions.map((assumption, index) => (
                  <li key={index}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {extras.length > 0 ? (
            <div className="stack stack--sm">
              <span className="strong small">{definition.name} specifics</span>
              <div className="kv">
                {extras.map(([key, value]) => (
                  <Fragment key={key}>
                    <span className="kv__key">{humanise(key)}</span>
                    <span className="kv__value">
                      <Structured value={value} />
                    </span>
                  </Fragment>
                ))}
              </div>
            </div>
          ) : null}

          {output?.next_agent_instructions ? (
            <p className="agent-card__body">Hand-off note: {output.next_agent_instructions}</p>
          ) : null}

          {run?.notes ? (
            <details className="small">
              <summary>How it reasoned before shaping its answer</summary>
              <pre className="prose mono scroller">{run.notes}</pre>
            </details>
          ) : null}

          {run ? <EnvelopeInspector missionId={run.missionId} runId={run.id} /> : null}

          {run ? (
            <p className="source-meta" style={{ margin: 0 }}>
              {formatDateTime(run.startedAt)} · {formatDuration(run.durationMs)}
              {run.inputTokens !== null || run.outputTokens !== null
                ? ` · ${run.inputTokens ?? 0} in / ${run.outputTokens ?? 0} out tokens`
                : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * What this agent was actually shown.
 *
 * Loaded only when asked for, because the envelope contains every upstream
 * agent's full output. It is the last link in the chain the island promises:
 * recommendation → agent → finding → evidence → source → and the input the
 * agent was working from when it said it.
 */
function EnvelopeInspector({ missionId, runId }: { missionId: string; runId: string }) {
  const [envelope, setEnvelope] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(): Promise<void> {
    if (envelope || loading) return;
    setLoading(true);
    setError(null);
    try {
      setEnvelope(await fetchRunEnvelope(missionId, runId));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="small" onToggle={(event) => (event.currentTarget.open ? void load() : undefined)}>
      <summary>Exactly what this agent was given</summary>
      {loading ? <p className="source-meta">Loading the envelope…</p> : null}
      {error ? <ErrorNote message={error} /> : null}
      {envelope ? (
        <pre className="prose mono scroller">{JSON.stringify(envelope, null, 2)}</pre>
      ) : null}
    </details>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <div className="source-item">
      <span className="source-ref">{finding.finding_id}</span>
      <div className="grow stack stack--sm">
        <div className="row row--between row--wrap" style={{ gap: 8 }}>
          <LabelChip label={finding.label} />
          <span className="source-meta">
            {finding.category} · importance {finding.importance}
          </span>
        </div>
        <p className="small" style={{ margin: 0 }}>{finding.claim}</p>
        <ConfidenceMeter value={finding.confidence} />
        {finding.evidence.length > 0 ? (
          <ul className="source-meta" style={{ margin: 0, paddingLeft: 18 }}>
            {finding.evidence.map((evidence, index) => (
              <li key={index}>
                {evidence.source_url ? (
                  <a href={evidence.source_url} target="_blank" rel="noreferrer noopener">
                    {evidence.source_title || evidence.source_url}
                  </a>
                ) : (
                  evidence.source_title || 'No source'
                )}
                {evidence.source_id ? <span className="mono"> {evidence.source_id}</span> : null}
                {evidence.support ? ` — ${evidence.support}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="source-meta" style={{ margin: 0 }}>
            No evidence attached — this claim rests on reasoning alone.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Renders whatever an agent's own schema added.
 *
 * Fourteen agents have fourteen shapes, and a new specialist arrives with a
 * prompt and a schema and nothing else. The alternative to a generic renderer
 * is a page that quietly drops the half of an agent's work it was not written
 * for.
 */
function Structured({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  if (typeof value === 'boolean') return <>{value ? 'yes' : 'no'}</>;
  if (typeof value === 'number' || typeof value === 'string') return <>{String(value)}</>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">none</span>;
    return (
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {value.map((item, index) => (
          <li key={index}>
            <Structured value={item} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="kv">
      {Object.entries(value as Record<string, unknown>).map(([key, child]) => (
        <Fragment key={key}>
          <span className="kv__key">{humanise(key)}</span>
          <span className="kv__value">
            <Structured value={child} />
          </span>
        </Fragment>
      ))}
    </div>
  );
}

// --- narration --------------------------------------------------------------

function Timeline({ events, agents }: { events: MissionEvent[]; agents: AgentDefinition[] }) {
  const names = new Map(agents.map((definition) => [definition.id, definition.name]));

  return (
    <section className="card stack">
      <div className="row row--between">
        <h2 className="report__heading">Mission timeline</h2>
        <span className="source-meta">{events.length} events</span>
      </div>
      {events.length === 0 ? (
        <Empty icon="🕰️" title="Nothing has happened yet" body="Events appear the moment the island starts work." />
      ) : (
        <ol className="timeline scroller" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {events.slice(-250).map((event) => {
            const tone = TIMELINE_TONE[event.type];
            return (
              <li key={event.id} className={`timeline__item ${tone ? `timeline__item--${tone}` : ''}`}>
                <span className="timeline__marker">
                  <span className="timeline__dot" />
                </span>
                <span>
                  <p className="timeline__text">{event.message}</p>
                  <span className="timeline__time">
                    {formatTime(event.createdAt)}
                    {event.agentId ? ` · ${names.get(event.agentId) ?? event.agentId}` : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function AuditTrail({ pkg }: { pkg: MissionPackage }) {
  const challenges = pkg.events.filter((event) => event.type === 'challenge');

  return (
    <section className="card stack">
      <h2 className="report__heading">Challenges and corrections</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Nothing is fixed silently. Every claim an agent changed after being challenged is here, with
        what it used to say.
      </p>

      {pkg.corrections.length === 0 && challenges.length === 0 ? (
        <Empty icon="⚖️" title="No corrections yet" body="No agent has had to correct another on this mission." />
      ) : null}

      {pkg.corrections.map((correction) => (
        <div key={correction.id} className="source-item">
          <span className="source-ref">{correction.findingId}</span>
          <div className="grow">
            <div className="row row--between row--wrap" style={{ gap: 8 }}>
              <span className="small strong">
                {correction.fromAgent} → {correction.toAgent}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span className={`pill pill--${correction.severity === 'high' ? 'negative' : 'warning'}`}>
                  {correction.severity}
                </span>
                <span className="pill pill--muted">round {correction.round}</span>
                <span className={`pill ${correction.resolved ? 'pill--positive' : 'pill--warning'}`}>
                  {correction.resolved ? 'resolved' : 'open'}
                </span>
              </span>
            </div>
            <div className="source-meta">Was: {correction.originalClaim}</div>
            <div className="small">Now: {correction.correctedClaim}</div>
            <div className="source-meta">Because: {correction.reason}</div>
          </div>
        </div>
      ))}

      {challenges.length > 0 ? (
        <div className="stack stack--sm">
          <span className="strong small">Challenges raised</span>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {challenges.map((event) => (
              <li key={event.id}>{event.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function VerificationPanel({ pkg, passed }: { pkg: MissionPackage; passed: boolean | null }) {
  if (pkg.verifications.length === 0) {
    return (
      <section className="card stack">
        <h2 className="report__heading">Verification</h2>
        <p className="small muted" style={{ margin: 0 }}>
          The Risk &amp; Verification agent has not reported on this mission yet.
        </p>
      </section>
    );
  }

  return (
    <section className="card card--flush stack" style={{ gap: 0 }}>
      <div className="row row--between row--wrap" style={{ padding: 18 }}>
        <h2 className="report__heading">Verification</h2>
        <span className={`pill ${passed ? 'pill--positive' : 'pill--negative'}`}>
          {passed === null ? 'in progress' : passed ? 'gate passed' : 'gate failed'}
        </span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Finding</th>
              <th>Agent</th>
              <th>Result</th>
              <th>Why</th>
              <th>What must happen</th>
              <th>Round</th>
            </tr>
          </thead>
          <tbody>
            {pkg.verifications.map((record) => (
              <tr key={record.id}>
                <td className="mono small">{record.findingId}</td>
                <td className="small">{record.agentId}</td>
                <td>
                  <span
                    className={`pill pill--${
                      record.status === 'verified'
                        ? 'positive'
                        : record.status === 'high_risk'
                          ? 'negative'
                          : 'warning'
                    }`}
                  >
                    {record.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="small" style={{ maxWidth: 320 }}>{record.reason}</td>
                <td className="small" style={{ maxWidth: 260 }}>
                  {record.resolved ? record.correctedValue || 'Resolved' : record.recommendedAction}
                </td>
                <td className="small tabular">{record.round}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SourceRegister({ pkg }: { pkg: MissionPackage }) {
  return (
    <section className="card stack">
      <div className="row row--between row--wrap">
        <h2 className="report__heading">Source register</h2>
        <span className="source-meta">{pkg.sources.length} sources</span>
      </div>
      {pkg.sources.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          No source has been recorded on this mission. Every claim made without one carries a label
          saying so.
        </p>
      ) : (
        pkg.sources.map((source) => (
          <div key={source.source_id} className="source-item">
            <span className="source-ref">{source.source_id}</span>
            <div className="grow">
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  {source.title || source.url}
                </a>
              ) : (
                <span>{source.title}</span>
              )}
              <div className="source-meta">
                {source.source_type} · {source.reliability} reliability
              </div>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

// --- the final report (§12) -------------------------------------------------

function ReportView({ report }: { report: FinalReport }) {
  const currency = report.financial_summary.currency || 'USD';
  const decision = report.recommendation.decision;

  return (
    <div className="report">
      <div className={`verdict verdict--${DECISION_TONE[decision]}`}>
        <div className="grow stack stack--sm">
          <span className="verdict__text">{DECISION_LABEL[decision]}</span>
          <p className="prose">{report.recommendation.reason}</p>
        </div>
        <div style={{ minWidth: 200 }}>
          <ConfidenceMeter
            value={report.overall_confidence}
            label="Overall confidence"
            note={report.confidence_explanation}
          />
        </div>
      </div>

      {report.simulation_notice ? (
        <div className="sim-notice" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{report.simulation_notice}</span>
        </div>
      ) : null}

      <ReportSection title="1. Executive summary">
        <p className="prose">{report.executive_summary}</p>
      </ReportSection>

      <ReportSection title="2. Key findings">
        {report.key_findings.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>No finding survived review.</p>
        ) : (
          report.key_findings.map((finding, index) => (
            <div key={index} className="source-item">
              <span className="source-ref">{index + 1}</span>
              <div className="grow stack stack--sm">
                <div className="row row--between row--wrap" style={{ gap: 8 }}>
                  <LabelChip label={finding.label} />
                  <span className="source-meta">
                    {finding.evidence.length > 0
                      ? `Evidence: ${finding.evidence.join(', ')}`
                      : 'No evidence cited'}
                  </span>
                </div>
                <p className="small" style={{ margin: 0 }}>{finding.finding}</p>
                <ConfidenceMeter value={finding.confidence} />
              </div>
            </div>
          ))
        )}
      </ReportSection>

      <ReportSection title="3. Research">
        <p className="prose">{report.research_summary}</p>
      </ReportSection>

      <ReportSection title="4. Competitors">
        <p className="prose">{report.competitor_summary}</p>
      </ReportSection>

      <ReportSection title="5. Market">
        <p className="prose">{report.market_summary}</p>
      </ReportSection>

      <ReportSection title="6. Analysis">
        <p className="prose">{report.analysis_summary}</p>
      </ReportSection>

      <ReportSection title="7. Financials">
        <div className="grid grid--3">
          <Stat label="Start-up cost" value={formatMoney(report.financial_summary.estimated_startup_cost, currency)} note="estimate" />
          <Stat label="Monthly cost" value={formatMoney(report.financial_summary.estimated_monthly_cost, currency)} note="estimate" />
          <Stat label="Monthly revenue" value={formatMoney(report.financial_summary.estimated_monthly_revenue, currency)} note="estimate" />
        </div>
        <p className="small muted" style={{ margin: 0 }}>{report.financial_summary.note}</p>
      </ReportSection>

      <ReportSection title="8. Major risks">
        <Bullets items={report.major_risks} empty="No major risk was recorded." />
      </ReportSection>

      <ReportSection title="9. Verification">
        <div className="grid grid--4">
          <Stat label="Claims reviewed" value={String(report.verification.total_claims_reviewed)} />
          <Stat label="Verified" value={String(report.verification.verified)} tone="positive" />
          <Stat label="Need verification" value={String(report.verification.needs_verification)} />
          <Stat
            label="High risk"
            value={String(report.verification.high_risk_items)}
            note={`${report.verification.contradictions} contradiction${report.verification.contradictions === 1 ? '' : 's'}`}
            tone={report.verification.high_risk_items > 0 ? 'negative' : undefined}
          />
        </div>
        <p className="small" style={{ margin: 0 }}>
          {report.verification.passed ? 'The verification gate passed' : 'The verification gate did not pass'}{' '}
          after {report.verification.rounds_used} correction round
          {report.verification.rounds_used === 1 ? '' : 's'}.
        </p>
      </ReportSection>

      <ReportSection title="10. Strategy">
        <p className="prose">{report.strategy_summary}</p>
      </ReportSection>

      <ReportSection title="11. Recommendation">
        <p className="strong" style={{ margin: 0 }}>{DECISION_LABEL[decision]}</p>
        <p className="prose">{report.recommendation.reason}</p>
      </ReportSection>

      <ReportSection title="12. Action plan">
        {report.action_plan.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>No action plan was produced.</p>
        ) : (
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {[...report.action_plan]
              .sort((a, b) => a.priority - b.priority)
              .map((item, index) => (
                <li key={index}>
                  <strong>{item.action}</strong>
                  <div className="source-meta">{item.reason}</div>
                </li>
              ))}
          </ol>
        )}
      </ReportSection>

      <ReportSection title="13. Assumptions">
        <Bullets items={report.assumptions} empty="No assumption was recorded, which is itself worth questioning." />
      </ReportSection>

      <ReportSection title="14. Still unknown">
        <Bullets items={report.unresolved_questions} empty="Nothing was left open." />
        {report.unresolved_issues.length > 0 ? (
          <div className="stack stack--sm">
            <span className="strong small">Unresolved issues</span>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {report.unresolved_issues.map((issue) => (
                <li key={issue.issue_id}>
                  <span className={`pill pill--${issue.severity === 'high' ? 'negative' : 'warning'}`}>
                    {issue.severity}
                  </span>{' '}
                  {issue.agent} · {issue.finding_id}: {issue.problem}
                  <div className="source-meta">Required: {issue.required_action}</div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </ReportSection>

      <ReportSection title="15. Corrections made">
        {report.corrections.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>No claim had to be corrected.</p>
        ) : (
          report.corrections.map((correction) => (
            <div key={correction.id} className="source-item">
              <span className="source-ref">{correction.findingId}</span>
              <div className="grow">
                <div className="small strong">
                  {correction.fromAgent} → {correction.toAgent}
                </div>
                <div className="source-meta">Was: {correction.originalClaim}</div>
                <div className="small">Now: {correction.correctedClaim}</div>
              </div>
            </div>
          ))
        )}
      </ReportSection>

      <ReportSection title="16. Sources">
        {report.sources.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No source was consulted on this mission. Weigh every claim above accordingly.
          </p>
        ) : (
          report.sources.map((source) => (
            <div key={source.source_id} className="source-item">
              <span className="source-ref">{source.source_id}</span>
              <div className="grow">
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.title || source.url}
                  </a>
                ) : (
                  <span>{source.title}</span>
                )}
                <div className="source-meta">
                  {source.source_type} · {source.reliability} reliability
                </div>
              </div>
            </div>
          ))
        )}
      </ReportSection>

      <ReportSection title="17. Who did what">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>Contribution</th>
              </tr>
            </thead>
            <tbody>
              {report.agent_summary.map((entry) => (
                <tr key={entry.agent}>
                  <td className="small strong">{entry.name || entry.agent}</td>
                  <td className="small">{entry.status}</td>
                  <td className="small">{entry.key_contribution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="source-meta" style={{ margin: 0 }}>
          {report.mission_reference} · generated {formatDateTime(report.generated_at)} · engine{' '}
          {report.engine}
        </p>
      </ReportSection>
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card report__section">
      <h2 className="report__heading">{title}</h2>
      {children}
    </section>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="small muted" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
