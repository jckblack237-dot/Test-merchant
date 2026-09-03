import { useEffect, type ReactNode } from 'react';

export function Spinner() {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <div className="skeleton" style={{ height: 108 }} />
      <div className="skeleton" style={{ height: 72 }} />
      <div className="skeleton" style={{ height: 72 }} />
      <span className="tiny muted center">Loading…</span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="alert" role="alert">
      {message}
    </p>
  );
}

export function Empty({ icon, title, body, action }: { icon: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty stack">
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="strong" style={{ margin: 0, color: 'var(--text)' }}>
        {title}
      </p>
      {body ? <p className="small" style={{ margin: 0 }}>{body}</p> : null}
      {action}
    </div>
  );
}

/** Bottom sheet used for the wallet QR and reward confirmations. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="row row--between" style={{ marginBottom: 14 }}>
          <h2 className="topbar__title">{title}</h2>
          <button type="button" className="iconbutton" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function formatPoints(points: number): string {
  return points.toLocaleString();
}

export function formatMoney(cents: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)}`;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'No activity yet';
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
