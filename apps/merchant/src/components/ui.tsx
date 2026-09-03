import { useEffect, type ReactNode } from 'react';

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

/**
 * Small dependency-free line chart. A charting library would be four times the
 * size of this whole app for one sparkline on one screen.
 */
export function LineChart({
  points, labelFor, valueFor, formatValue,
}: {
  points: { day: string }[];
  labelFor: (point: any) => string;
  valueFor: (point: any) => number;
  formatValue: (value: number) => string;
}) {
  if (points.length === 0) {
    return <p className="muted small center" style={{ padding: 40 }}>No activity in this period yet.</p>;
  }

  const width = 720;
  const height = 190;
  const padding = { top: 14, right: 12, bottom: 24, left: 46 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const values = points.map(valueFor);
  const max = Math.max(...values, 1);
  const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;

  const coords = points.map((point, index) => ({
    x: padding.left + index * stepX,
    y: padding.top + innerHeight - (valueFor(point) / max) * innerHeight,
    point,
  }));

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area =
    `${line} L${coords[coords.length - 1]!.x.toFixed(1)},${(padding.top + innerHeight).toFixed(1)}` +
    ` L${coords[0]!.x.toFixed(1)},${(padding.top + innerHeight).toFixed(1)} Z`;

  const gridLines = [0, 0.5, 1];

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
         aria-label={`Chart of ${points.length} days, peaking at ${formatValue(max)}`}>
      {gridLines.map((fraction) => {
        const y = padding.top + innerHeight * fraction;
        return (
          <g key={fraction}>
            <line className="chart__grid" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
            <text className="chart__label" x={4} y={y + 3.5}>
              {formatValue(Math.round(max * (1 - fraction)))}
            </text>
          </g>
        );
      })}
      <path className="chart__area" d={area} />
      <path className="chart__line" d={line} />
      {coords.length <= 40
        ? coords.map((c, i) => <circle key={i} className="chart__dot" cx={c.x} cy={c.y} r={2.2} />)
        : null}
      {coords.length > 0 ? (
        <>
          <text className="chart__label" x={padding.left} y={height - 6}>
            {labelFor(coords[0]!.point)}
          </text>
          <text className="chart__label" x={width - padding.right} y={height - 6} textAnchor="end">
            {labelFor(coords[coords.length - 1]!.point)}
          </text>
        </>
      ) : null}
    </svg>
  );
}

// --- formatting -------------------------------------------------------------

export function formatMoney(cents: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return (cents / 100).toFixed(2);
  }
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return formatDate(iso);
}

export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}
