import { useEffect, type ReactNode } from 'react';

/**
 * The island's shared vocabulary, restated for the browser bundle.
 *
 * These unions mirror `server/src/island/types.ts` exactly. They are declared
 * here rather than imported so the visual layer compiles on its own — and
 * because identical string unions stay assignable, values typed by the data
 * layer drop straight into these props.
 */
export type Label = 'VERIFIED' | 'ESTIMATE' | 'NEEDS_VERIFICATION' | 'HIGH_RISK';

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

export type MissionStatus =
  | 'created'
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'aborted';

export type Stage = 'plan' | 'gather' | 'analyse' | 'verify' | 'quantify' | 'strategise' | 'review';

export type Decision = 'proceed' | 'proceed_with_caution' | 'more_research' | 'do_not_proceed';

export const STAGE_ORDER: Stage[] = [
  'plan',
  'gather',
  'analyse',
  'verify',
  'quantify',
  'strategise',
  'review',
];

export const STAGE_LABEL: Record<Stage, string> = {
  plan: 'Planning',
  gather: 'Gathering',
  analyse: 'Analysis',
  verify: 'Verification',
  quantify: 'Financial',
  strategise: 'Strategy',
  review: 'Chief review',
};

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  waiting: 'Waiting',
  queued: 'Queued',
  working: 'Working',
  completed: 'Completed',
  failed: 'Failed',
  needs_review: 'Needs review',
  retrying: 'Retrying',
  blocked: 'Blocked',
  skipped: 'Skipped',
};

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  created: 'Draft',
  planning: 'Planning',
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  aborted: 'Aborted',
};

export const LABEL_EMOJI: Record<Label, string> = {
  VERIFIED: '🟢',
  ESTIMATE: '🟡',
  NEEDS_VERIFICATION: '🟠',
  HIGH_RISK: '🔴',
};

export const LABEL_TEXT: Record<Label, string> = {
  VERIFIED: 'Verified',
  ESTIMATE: 'Estimate',
  NEEDS_VERIFICATION: 'Needs verification',
  HIGH_RISK: 'High risk',
};

export const DECISION_LABEL: Record<Decision, string> = {
  proceed: '🟢 PROCEED',
  proceed_with_caution: '🟡 PROCEED WITH CAUTION',
  more_research: '🟠 MORE RESEARCH REQUIRED',
  do_not_proceed: '🔴 DO NOT PROCEED',
};

/** Which `.verdict--*` modifier dresses each recommendation. */
export const DECISION_TONE: Record<Decision, string> = {
  proceed: 'proceed',
  proceed_with_caution: 'caution',
  more_research: 'research',
  do_not_proceed: 'stop',
};

const LABEL_TONE: Record<Label, string> = {
  VERIFIED: 'verified',
  ESTIMATE: 'estimate',
  NEEDS_VERIFICATION: 'needs',
  HIGH_RISK: 'risk',
};

const MISSION_STATUS_TONE: Record<MissionStatus, string> = {
  created: 'pill--muted',
  planning: 'pill--info',
  running: 'pill--info',
  awaiting_approval: 'pill--warning',
  paused: 'pill--warning',
  completed: 'pill--positive',
  failed: 'pill--negative',
  aborted: 'pill--negative',
};

// --- primitives -------------------------------------------------------------

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: index === 0 ? 88 : 64 }} />
      ))}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert">
      <div className="row row--between">
        <span>{message}</span>
        {onRetry ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty stack stack--sm">
      <div className="empty__icon" aria-hidden="true">{icon}</div>
      <p className="strong" style={{ margin: 0, color: 'var(--text)' }}>{title}</p>
      {body ? <p className="small" style={{ margin: 0 }}>{body}</p> : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}

export function Modal({
  title, onClose, children, wide = false,
}: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? 'modal--wide' : ''}`}>
        <div className="row row--between" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
          <button type="button" className="iconbutton" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({
  label, value, note, tone,
}: { label: string; value: string; note?: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="card stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {note ? (
        <span className="stat__note" style={tone ? { color: `var(--${tone})` } : undefined}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

// --- island vocabulary ------------------------------------------------------

/** The label a claim carries, emoji and all. `text` overrides the wording when
 *  the caller has something more specific to say than the label's own name. */
export function LabelChip({ label, text }: { label: Label; text?: string }) {
  return (
    <span className={`chip chip--${LABEL_TONE[label]}`}>
      <span className="chip__emoji" aria-hidden="true">{LABEL_EMOJI[label]}</span>
      {text ?? LABEL_TEXT[label]}
    </span>
  );
}

export function ConfidenceMeter({
  value, label = 'Confidence', note,
}: { value: number; label?: string; note?: string }) {
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(safe * 100);
  const band = safe >= 0.7 ? 'strong' : safe >= 0.45 ? 'medium' : 'weak';

  return (
    <div className={`meter meter--${band}`}>
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value tabular">{percent}%</span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${percent} percent`}
      >
        <div className="meter__fill" style={{ width: `${percent}%` }} />
      </div>
      {note ? <span className="meter__note">{note}</span> : null}
    </div>
  );
}

export function StatusPill({ status }: { status: MissionStatus }) {
  return <span className={`pill ${MISSION_STATUS_TONE[status]}`}>{MISSION_STATUS_LABEL[status]}</span>;
}

export function AgentStatePill({ state }: { state: AgentState }) {
  return (
    <span className={`statepill statepill--${state}`}>
      <span className="statepill__dot" aria-hidden="true" />
      {AGENT_STATE_LABEL[state]}
    </span>
  );
}

// --- formatting -------------------------------------------------------------

/**
 * Unlike the CRM, which counts money in cents, the island's financial figures
 * arrive from the agents as whole currency units — they are estimates about a
 * business idea, not amounts anyone was charged.
 */
export function formatMoney(value: number, currency = 'USD'): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

export function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : '—';
}

export function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86_400);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDateTime(iso);
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}
