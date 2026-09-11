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

/**
 * The recommendation, in words alone.
 *
 * The decision used to shout in capitals behind a coloured circle. It now says
 * what it means once, in the same voice as the rest of the page; the colour
 * that used to come from the emoji comes from the tone class the caller puts
 * around it, which is the only thing on the page allowed to carry state.
 */
export const DECISION_LABEL: Record<Decision, string> = {
  proceed: 'Proceed',
  proceed_with_caution: 'Proceed with caution',
  more_research: 'More research required',
  do_not_proceed: 'Do not proceed',
};

/** Which `.verdict--*` modifier dresses each recommendation. */
export const DECISION_TONE: Record<Decision, string> = {
  proceed: 'proceed',
  proceed_with_caution: 'caution',
  more_research: 'research',
  do_not_proceed: 'stop',
};

/** The same four decisions where they appear at pill size, in a list or beside
 *  a heading, rather than at the head of a report. */
export const DECISION_PILL: Record<Decision, string> = {
  proceed: 'pill--positive',
  proceed_with_caution: 'pill--warning',
  more_research: 'pill--info',
  do_not_proceed: 'pill--negative',
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

// --- marks ------------------------------------------------------------------

/**
 * The handful of marks the chrome itself needs.
 *
 * Agent iconography lives in `glyphs.tsx`; these belong to the application
 * rather than to any agent. All of them are drawn to the same rules — a 24×24
 * grid, `currentColor`, 1.6 stroke — so a mark inherits whatever colour the
 * thing around it already decided on, and nothing here has to be an emoji.
 */

/** The product mark: a landmass and one contour ring, in the same cartographic
 *  language the map is drawn in. */
export function IslandMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* A solid landmass with one station punched out of it. Drawn as fill
          rather than stroke because at 16px a 1.6px outline of a soft shape
          collapses into a grey ring and stops reading as anything at all. */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.2 3.2C16.7 3.2 20.8 6.1 20.8 10.4C20.8 15.7 16.5 20.8 11.4 20.8C6.8 20.8 3.2 17
           3.2 12.4C3.2 7.1 7.5 3.2 12.2 3.2ZM12 9.1C10.4 9.1 9.1 10.4 9.1 12C9.1 13.6 10.4 14.9
           12 14.9C13.6 14.9 14.9 13.6 14.9 12C14.9 10.4 13.6 9.1 12 9.1Z"
      />
    </svg>
  );
}

/**
 * The mark on a disclosure the reader is not allowed to skim past. It carries
 * no colour of its own — the banner it sits in decides that.
 *
 * The one inline style in this file: every banner it sits in is a flex row, and
 * a replaced element with no flex-basis of its own is squeezed by a long enough
 * sentence beside it. That is the mark's own invariant, not a style choice.
 */
export function AlertMark({ size = 17 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      <path d="M12 4.4L21 19.8H3Z" />
      <path d="M12 10V13.9M12 16.7H12.01" />
    </svg>
  );
}

function CloseMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6.4 6.4L17.6 17.6M17.6 6.4L6.4 17.6" />
    </svg>
  );
}

// --- primitives -------------------------------------------------------------

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        // The heights are the shape of the thing being waited for, not styling:
        // a heading block over a run of rows.
        <div key={index} className="skeleton" style={{ height: index === 0 ? 88 : 64 }} />
      ))}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert">
      <div className="row row--between">
        <span className="row">
          <AlertMark size={16} />
          <span>{message}</span>
        </span>
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
      {/* An empty state is typographic. The slot stays for a mark worth drawing;
          it is simply not a place to park an emoji. */}
      {icon ? <div className="empty__icon" aria-hidden="true">{icon}</div> : null}
      <span className="strong">{title}</span>
      {body ? <span className="small">{body}</span> : null}
      {action ? <div>{action}</div> : null}
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
        <div className="stack">
          <div className="row row--between">
            <h2 className="report__heading">{title}</h2>
            <button type="button" className="iconbutton" onClick={onClose} aria-label="Close">
              <CloseMark />
            </button>
          </div>
          {children}
        </div>
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
        <span className={`stat__note ${tone ? `stat__note--${tone}` : ''}`}>{note}</span>
      ) : null}
    </div>
  );
}

// --- island vocabulary ------------------------------------------------------

/** The label a claim carries, emoji and all. `text` overrides the wording when
 *  the caller has something more specific to say than the label's own name.
 *
 *  These four are the one place an emoji survives the redesign: the coloured
 *  circle is the meaning rather than decoration around it. */
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
        {/* Data, not dressing: the fill is the number it is reporting. */}
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
