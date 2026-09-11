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
  type RosterEntry,
  type Severity,
} from '../lib/api';
import { canAct, useSession } from '../lib/session';
import {
  AGENT_STATE_LABEL,
  AgentStatePill,
  AlertMark,
  ConfidenceMeter,
  DECISION_LABEL,
  DECISION_PILL,
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
  formatPercent,
  formatTime,
} from '../components/ui';
import { AgentGlyph } from '../components/glyphs';
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
  // A correction round is a real run of that agent, and it ends with
  // `correction_applied` rather than `agent_completed`. Without this the last
  // state-bearing event for a corrected agent stays `agent_started` and the map
  // shows it working forever, on a mission that has already finished.
  correction_applied: 'completed',
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

/** Severity said in words. A pink pill beside an amber label chip and a green
 *  state pill makes three colours argue over one claim; the word carries it. */
const SEVERITY_LEAD: Record<Severity, string> = {
  high: 'High severity',
  medium: 'Medium severity',
  low: 'Low severity',
};

function humanise(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Agent id → the name every other surface shows it under.
 *
 * `risk_verification` is a database key. It has no business appearing in a
 * sentence fifty pixels below the same agent's card title, so every line that
 * names an agent goes through here first.
 */
function agentNamer(roster: RosterEntry[]): (agentId: string) => string {
  const names = new Map(roster.map((entry) => [entry.definition.id, entry.definition.name]));
  return (agentId) => names.get(agentId) ?? humanise(agentId);
}

/** The status the report stored for an agent, said the way the page says it. */
function stateLabel(status: string): string {
  return AGENT_STATE_LABEL[status as AgentState] ?? humanise(status);
}

/** One warning: a sentence with at most one identifier in it. The identifier is
 *  set apart as a reference so a key is never read as a word. */
interface Warning {
  id: string;
  lead: string;
  ref?: string;
  tail?: string;
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

  /** Built from the whole roster rather than from the mission's own crew: an
   *  agent can be named by a challenge or a correction after being switched off. */
  const name = useMemo(() => agentNamer(pkg?.roster ?? []), [pkg]);

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
    const out: Warning[] = [];
    for (const definition of agents) {
      const state = states[definition.id];
      if (state === 'failed') {
        out.push({ id: `failed-${definition.id}`, lead: `${definition.name} failed; the mission continued without it.` });
      }
      if (state === 'retrying') {
        out.push({ id: `retrying-${definition.id}`, lead: `${definition.name} is retrying after an unusable response.` });
      }
      if (state === 'needs_review') {
        out.push({ id: `review-${definition.id}`, lead: `${definition.name} produced work that needs a human read.` });
      }
    }
    for (const record of verification.unresolved) {
      if (record.severity === 'high') {
        out.push({
          id: `flag-${record.id}`,
          lead: 'Unresolved high-severity flag on ',
          ref: record.findingId,
          tail: `: ${record.reason}`,
        });
      }
    }
    for (const correction of pkg?.corrections ?? []) {
      if (!correction.resolved) {
        out.push({
          id: `challenge-${correction.id}`,
          lead: `Open challenge — ${name(correction.fromAgent)} → ${name(correction.toAgent)}: ${correction.reason}`,
        });
      }
    }
    return out;
  }, [agents, states, verification, pkg, name]);

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
  const remaining = agents.length - completedCount;
  const finished = agents.length > 0 && remaining === 0;

  // An agent name set at 28px wraps to two lines and leaves one card in a
  // four-up row 22px taller than its neighbours, and an em dash for "nobody" is
  // read as a failed render. A count always fits on one line, and a mission that
  // has ended says so; the caption underneath names who is actually working.
  const ended = !LIVE.has(mission.status);
  const workingValue = firstWorking
    ? `${working.length} agent${working.length === 1 ? '' : 's'}`
    : ended
      ? 'Finished'
      : 'Idle';
  const workingNote = firstWorking
    ? working.length === 1
      ? firstWorking.name
      : [...new Set(working.map((definition) => STAGE_LABEL[definition.stage]))].join(' · ')
    : ended
      ? mission.status === 'completed'
        ? 'Every agent has reported'
        : 'The mission ended early'
      : 'No agent is running';

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <div className="row row--between row--wrap row--top">
          <div className="page-head">
            <div className="row row--wrap">
              <span className="mission-item__ref">{mission.reference}</span>
              <StatusPill status={mission.status} />
              {live ? (
                <span className={`pill ${streamNote ? 'pill--warning' : 'pill--positive'}`}>
                  {streamNote ? 'Reconnecting' : 'Live'}
                </span>
              ) : null}
            </div>
            <h1 className="page-head__title page-head__title--task">{mission.userTask}</h1>
            <p className="page-head__sub">
              Started {formatDateTime(mission.startedAt ?? mission.createdAt)} by{' '}
              {mission.createdByName || 'someone'} ·{' '}
              {mission.mode === 'approval' ? 'approval gates' : 'automatic'}
              {mission.geography ? ` · ${mission.geography}` : ''}
              {mission.currency ? ` · ${mission.currency}` : ''}
            </p>
          </div>

          <div className="row row--wrap">
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

        {mission.objective ? <span className="small">{mission.objective}</span> : null}

        {mission.engine === 'simulation' ? (
          <div className="sim-notice" role="alert">
            <AlertMark />
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
        <Stat label="Working now" value={workingValue} note={workingNote} />
        <Stat
          label="Completed"
          value={`${completedCount}/${agents.length}`}
          note={remaining === 0 ? 'Nothing left to run' : `${remaining} still to run`}
        />
        <Stat
          label="Progress"
          value={`${progress}%`}
          // "100%" over "Not started" is the caption contradicting its own
          // number: the stage clears when the mission ends, so it cannot be the
          // only thing the caption knows about.
          note={
            finished
              ? 'All stages done'
              : mission.currentStage
                ? STAGE_LABEL[mission.currentStage]
                : progress > 0
                  ? 'No stage running'
                  : 'Not started'
          }
        />
        <Stat
          label="Verification"
          value={verification.passed === null ? 'Pending' : verification.passed ? 'Passed' : 'Failed'}
          note={`${verification.unresolved.length} unresolved · ${verification.rounds} round${verification.rounds === 1 ? '' : 's'}`}
          tone={verification.passed === false ? 'negative' : verification.passed ? 'positive' : undefined}
        />
      </div>

      <div className="card stack">
        {/* The progress bar used to sit here: a full-bleed accent bar restating a
            percentage printed 80px above, inside a card about warnings. The
            number already reads, so it is dropped rather than moved. */}
        {warnings.length > 0 ? (
          <div className="stack stack--sm">
            <span className="eyebrow">Warnings ({warnings.length})</span>
            <ul className="bullets small">
              {warnings.map((warning) => (
                <li key={warning.id}>
                  {warning.lead}
                  {warning.ref ? <span className="mono">{warning.ref}</span> : null}
                  {warning.tail}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <span className="small muted">No warnings raised so far.</span>
        )}
        {streamNote ? <span className="launch__hint">{streamNote}</span> : null}
      </div>

      <section className="card stack">
        <div className="row row--between row--wrap">
          <h2 className="report__heading">The island</h2>
          <span className="launch__hint">
            {activeTransfer
              ? `Handing off: ${name(activeTransfer.from)} → ${name(activeTransfer.to)}`
              : 'Select a station to open that agent’s work.'}
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
            name={name}
            onToggle={() => setOpen((current) => ({ ...current, [definition.id]: !current[definition.id] }))}
          />
        ))}
      </section>

      <div className="split split--even">
        <Timeline events={events} name={name} />
        <AuditTrail pkg={pkg} name={name} />
      </div>

      <VerificationPanel pkg={pkg} passed={verification.passed} name={name} />

      <SourceRegister pkg={pkg} />

      {report ? <ReportView report={report} name={name} /> : null}

      {mission.status === 'completed' ? (
        <section className="card stack">
          <h2 className="report__heading">Ask a follow-up</h2>
          <span className="small muted">
            Answered strictly from this mission's own findings and sources. If the answer is not in
            the package you will be told so, not guessed at.
          </span>

          {pkg.followups.map((followup) => (
            <div key={followup.id} className="source-item">
              <div className="grow stack stack--sm">
                <span className="strong">{followup.question}</span>
                <p className="prose">{followup.answer}</p>
                <span className="source-meta">{formatDateTime(followup.createdAt)}</span>
              </div>
            </div>
          ))}

          {/* The field stood at 40px with a 31px pill beside it, so a paired
              control and its own submit had two different heights. Stacked, they
              share a left edge, and the button is the full-size primary action
              of the card — the shape the launch card already uses. */}
          <form className="stack stack--sm" onSubmit={ask}>
            <input
              className="input"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What would change this recommendation?"
              aria-label="Ask a follow-up question about this mission"
            />
            <div>
              <button className="btn" type="submit" disabled={asking || !question.trim()}>
                {asking ? 'Asking…' : 'Ask'}
              </button>
            </div>
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

/** The disclosure caret. Two paths rather than one rotated path, so the mark
 *  never depends on a transform the stylesheet would have to know about. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className="muted"
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={open ? 'M6.6 9.6L12 15L17.4 9.6' : 'M9.6 6.6L15 12L9.6 17.4'} />
    </svg>
  );
}

function AgentPanel({
  definition,
  run,
  state,
  open,
  highlighted,
  name,
  onToggle,
}: {
  definition: AgentDefinition;
  run: AgentRunRecord | null;
  state: AgentState;
  open: boolean;
  highlighted: boolean;
  name: (agentId: string) => string;
  onToggle: () => void;
}) {
  const output = run?.output ?? null;
  const findings = output?.findings ?? [];
  const extras = output ? Object.entries(output).filter(([key]) => !CORE_OUTPUT_KEYS.has(key)) : [];

  return (
    <article className={`agent-card ${highlighted ? 'is-selected' : ''}`}>
      {/* The confidence meter shares the head's line rather than sitting under
          it, so a collapsed card is exactly one row tall. The chevron then reads
          against the middle of the card instead of hanging 36px above it, nine
          times down a report. */}
      <div className="row">
        {/* The only inline style left in these pages: a button has to be stripped
            back to a plain row before it can wear a card's head, and the head's
            own rule starts its children at the top — which is where the chevron
            was stranded. Neither is something the sheet says yet. */}
        <button
          type="button"
          className="agent-card__head grow"
          onClick={onToggle}
          aria-expanded={open}
          style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', alignItems: 'center' }}
        >
          <span className="agent-card__emoji" aria-hidden="true">
            <AgentGlyph agent={definition.id} size={18} />
          </span>
          <span className="grow">
            <span className="agent-card__name">{definition.name}</span>
            <span className="agent-card__role">
              {definition.role} · {STAGE_LABEL[definition.stage]}
              {run && run.attempt > 1 ? ` · attempt ${run.attempt}` : ''}
              {run && run.round > 0 ? ` · correction round ${run.round}` : ''}
            </span>
          </span>
          <AgentStatePill state={state} />
          <Chevron open={open} />
        </button>

        {run?.confidence !== null && run?.confidence !== undefined ? (
          <div className="agent-panel__confidence">
            <ConfidenceMeter value={run.confidence} label="Agent confidence" />
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="stack">
          {!run ? <p className="agent-card__body">This agent has not run yet.</p> : null}
          {run?.error ? <ErrorNote message={run.error} /> : null}

          {findings.length > 0 ? (
            <div className="stack stack--sm">
              <span className="eyebrow">Findings</span>
              {findings.map((finding) => (
                <FindingRow key={finding.finding_id} finding={finding} />
              ))}
            </div>
          ) : null}

          {output && output.issues.length > 0 ? (
            <div className="stack stack--sm">
              <span className="eyebrow">Issues it raised</span>
              <ul className="bullets small">
                {output.issues.map((issue) => (
                  <li key={issue.issue_id}>
                    {/* Severity leads in ink rather than in a pink pill: the card
                        already carries a state chip and a label chip, and a third
                        colour for the same claim makes all three mean less. */}
                    <strong>{SEVERITY_LEAD[issue.severity]}</strong> —{' '}
                    {issue.target_agent ? name(issue.target_agent) : 'its own caveat'}
                    {issue.target_finding_id ? <span className="mono"> {issue.target_finding_id}</span> : null}
                    : {issue.problem}
                    <div className="source-meta">Required: {issue.required_action}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {output && output.recommendations.length > 0 ? (
            <div className="stack stack--sm">
              <span className="eyebrow">Recommendations</span>
              <ol className="bullets small">
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
              <span className="eyebrow">Assumptions</span>
              <ul className="bullets small">
                {output.assumptions.map((assumption, index) => (
                  <li key={index}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {extras.length > 0 ? (
            <div className="stack stack--sm">
              <span className="eyebrow">{definition.name} specifics</span>
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
            <span className="source-meta">
              {formatDateTime(run.startedAt)} · {formatDuration(run.durationMs)}
              {run.inputTokens !== null || run.outputTokens !== null
                ? ` · ${run.inputTokens ?? 0} in / ${run.outputTokens ?? 0} out tokens`
                : ''}
            </span>
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
        <div className="row row--between row--wrap">
          <LabelChip label={finding.label} />
          {/* The agent's own confidence meter sits on the card head 130px above,
              at the same value and the same width. One bar per card; the
              finding's own number is told here in figures. */}
          <span className="source-meta">
            {finding.category} · importance {finding.importance} · confidence{' '}
            <span className="tabular">{formatPercent(finding.confidence)}</span>
          </span>
        </div>
        <span className="small">{finding.claim}</span>
        {finding.evidence.length > 0 ? (
          <ul className="bullets source-meta">
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
          <span className="source-meta">
            No evidence attached — this claim rests on reasoning alone.
          </span>
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
      <ul className="bullets">
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

function Timeline({
  events,
  name,
}: {
  events: MissionEvent[];
  name: (agentId: string) => string;
}) {
  return (
    <section className="card stack">
      <div className="row row--between">
        <h2 className="report__heading">Mission timeline</h2>
        <span className="source-meta">{events.length} events</span>
      </div>
      {events.length === 0 ? (
        <Empty icon="" title="Nothing has happened yet" body="Events appear the moment the island starts work." />
      ) : (
        <ol className="timeline scroller">
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
                    {event.agentId ? ` · ${name(event.agentId)}` : ''}
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

function AuditTrail({ pkg, name }: { pkg: MissionPackage; name: (agentId: string) => string }) {
  const challenges = pkg.events.filter((event) => event.type === 'challenge');

  return (
    <section className="card stack">
      <h2 className="report__heading">Challenges and corrections</h2>
      <span className="small muted">
        Nothing is fixed silently. Every claim an agent changed after being challenged is here, with
        what it used to say.
      </span>

      {pkg.corrections.length === 0 && challenges.length === 0 ? (
        <Empty icon="" title="No corrections yet" body="No agent has had to correct another on this mission." />
      ) : null}

      {pkg.corrections.map((correction) => (
        <div key={correction.id} className="source-item">
          <span className="source-ref">{correction.findingId}</span>
          <div className="grow">
            <div className="row row--between row--wrap">
              <span className="small strong">
                {name(correction.fromAgent)} → {name(correction.toAgent)}
              </span>
              <span className="row">
                <span className={`pill pill--${correction.severity === 'high' ? 'negative' : 'warning'}`}>
                  {correction.severity}
                </span>
                <span className="pill pill--muted">Round {correction.round}</span>
                <span className={`pill ${correction.resolved ? 'pill--positive' : 'pill--warning'}`}>
                  {correction.resolved ? 'Resolved' : 'Open'}
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
          <span className="eyebrow">Challenges raised</span>
          <ul className="bullets small">
            {challenges.map((event) => (
              <li key={event.id}>{event.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function VerificationPanel({
  pkg,
  passed,
  name,
}: {
  pkg: MissionPackage;
  passed: boolean | null;
  name: (agentId: string) => string;
}) {
  if (pkg.verifications.length === 0) {
    return (
      <section className="card stack">
        <h2 className="report__heading">Verification</h2>
        <span className="small muted">
          The Risk &amp; Verification agent has not reported on this mission yet.
        </span>
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="row row--between row--wrap">
        <h2 className="report__heading">Verification</h2>
        <span className={`pill ${passed ? 'pill--positive' : 'pill--negative'}`}>
          {passed === null ? 'In progress' : passed ? 'Gate passed' : 'Gate failed'}
        </span>
      </div>
      <div className="card card--flush table-wrap">
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
                <td className="small">{name(record.agentId)}</td>
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
                    {humanise(record.status)}
                  </span>
                </td>
                <td className="small">{record.reason}</td>
                <td className="small">
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
        <span className="small muted">
          No source has been recorded on this mission. Every claim made without one carries a label
          saying so.
        </span>
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

function ReportView({
  report,
  name,
}: {
  report: FinalReport;
  name: (agentId: string) => string;
}) {
  const currency = report.financial_summary.currency || 'USD';
  const decision = report.recommendation.decision;

  return (
    <div className="report">
      <div className={`verdict verdict--${DECISION_TONE[decision]}`}>
        <div className="grow stack stack--sm">
          <span className="verdict__text">{DECISION_LABEL[decision]}</span>
          <p className="prose">{report.recommendation.reason}</p>
        </div>
        <ConfidenceMeter
          value={report.overall_confidence}
          label="Overall confidence"
          note={report.confidence_explanation}
        />
      </div>

      {report.simulation_notice ? (
        <div className="sim-notice" role="alert">
          <AlertMark />
          <span>{report.simulation_notice}</span>
        </div>
      ) : null}

      <ReportSection title="1. Executive summary">
        <p className="prose">{report.executive_summary}</p>
      </ReportSection>

      <ReportSection title="2. Key findings">
        {report.key_findings.length === 0 ? (
          <span className="small muted">No finding survived review.</span>
        ) : (
          report.key_findings.map((finding, index) => (
            <div key={index} className="source-item">
              <span className="source-ref">{index + 1}</span>
              <div className="grow stack stack--sm">
                <div className="row row--between row--wrap">
                  <LabelChip label={finding.label} />
                  <span className="source-meta">
                    {finding.evidence.length > 0
                      ? `Evidence: ${finding.evidence.join(', ')}`
                      : 'No evidence cited'}
                  </span>
                </div>
                <span className="small">{finding.finding}</span>
                <ConfidenceMeter value={finding.confidence} label={null} />
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
        <span className="small muted">{report.financial_summary.note}</span>
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
        <span className="small">
          {report.verification.passed ? 'The verification gate passed' : 'The verification gate did not pass'}{' '}
          after {report.verification.rounds_used} correction round
          {report.verification.rounds_used === 1 ? '' : 's'}.
        </span>
      </ReportSection>

      <ReportSection title="10. Strategy">
        <p className="prose">{report.strategy_summary}</p>
      </ReportSection>

      <ReportSection title="11. Recommendation">
        <div className="row row--wrap">
          <span className={`pill ${DECISION_PILL[decision]}`}>{DECISION_LABEL[decision]}</span>
        </div>
        <p className="prose">{report.recommendation.reason}</p>
      </ReportSection>

      <ReportSection title="12. Action plan">
        {report.action_plan.length === 0 ? (
          <span className="small muted">No action plan was produced.</span>
        ) : (
          <ol className="bullets small">
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
            <span className="eyebrow">Unresolved issues</span>
            <ul className="bullets small">
              {report.unresolved_issues.map((issue) => (
                <li key={issue.issue_id}>
                  <span className={`pill pill--${issue.severity === 'high' ? 'negative' : 'warning'}`}>
                    {issue.severity}
                  </span>{' '}
                  {name(issue.agent)} · <span className="mono">{issue.finding_id}</span>:{' '}
                  {issue.problem}
                  <div className="source-meta">Required: {issue.required_action}</div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </ReportSection>

      <ReportSection title="15. Corrections made">
        {report.corrections.length === 0 ? (
          <span className="small muted">No claim had to be corrected.</span>
        ) : (
          report.corrections.map((correction) => (
            <div key={correction.id} className="source-item">
              <span className="source-ref">{correction.findingId}</span>
              <div className="grow">
                <div className="small strong">
                  {name(correction.fromAgent)} → {name(correction.toAgent)}
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
          <span className="small muted">
            No source was consulted on this mission. Weigh every claim above accordingly.
          </span>
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
        {/* The table's cells are inset 18px by their own padding, so bare in a
            padded card the whole table hung to the right of its title with
            nothing to justify it. Given its own flush card it has a left edge on
            the heading's line, which is the shape the verification table uses. */}
        <div className="card card--flush table-wrap">
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
                  {/* Regular weight: the header row already carries the
                      structure, and a bold first column draws a black stripe
                      down an otherwise quiet table. */}
                  <td className="small">{entry.name || name(entry.agent)}</td>
                  <td className="small">{stateLabel(entry.status)}</td>
                  <td className="small">{entry.key_contribution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="source-meta">
          {report.mission_reference} · generated {formatDateTime(report.generated_at)} · engine{' '}
          {report.engine}
        </span>
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
  if (items.length === 0) return <span className="small muted">{empty}</span>;
  return (
    <ul className="bullets small">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
