import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LedgerEntry } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Empty, ErrorNote, Loading, formatDateTime, formatMoney, formatNumber } from '../../components/ui';

const TYPES = [
  ['', 'All activity'],
  ['earn', 'Points earned'],
  ['redeem', 'Rewards redeemed'],
  ['adjust', 'Manual adjustments'],
  ['signup_bonus', 'Welcome bonuses'],
] as const;

/** The whole programme's points ledger — every movement, newest first. */
export function Activity() {
  const { merchant } = useSession();
  const [type, setType] = useState('');
  const [rows, setRows] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const query = type ? `&type=${type}` : '';
    api<{ transactions: LedgerEntry[] }>(`/merchant/points/transactions?limit=200${query}`)
      .then((response) => {
        if (!cancelled) setRows(response.transactions);
      })
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  return (
    <div className="stack">
      <div className="row row--between row--wrap">
        <p className="muted small" style={{ margin: 0 }}>
          Every points movement in your programme, newest first.
        </p>
        <select
          className="select"
          style={{ width: 'auto' }}
          value={type}
          onChange={(event) => setType(event.target.value)}
          aria-label="Filter activity"
        >
          {TYPES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {!rows ? (
        <Loading rows={2} />
      ) : rows.length === 0 ? (
        <Empty icon="🧾" title="No activity yet" body="Points awarded at the counter will show up here." />
      ) : (
        <div className="card card--flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Customer</th>
                  <th>Activity</th>
                  <th>Where</th>
                  <th>Staff</th>
                  <th className="right">Amount</th>
                  <th className="right">Points</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.createdAt)}</td>
                    <td>
                      <div className="small truncate">{row.customerName}</div>
                      <div className="tiny muted">{row.memberNumber}</div>
                    </td>
                    <td className="small">{row.note || labelFor(row.type)}</td>
                    <td className="small muted">{row.locationName ?? '—'}</td>
                    <td className="small muted">{row.staffName ?? (row.source === 'pos' ? 'Till' : '—')}</td>
                    <td className="right tabular muted">
                      {row.amountCents > 0 ? formatMoney(row.amountCents, merchant.currency) : '—'}
                    </td>
                    <td
                      className="right tabular strong"
                      style={{ color: row.pointsDelta >= 0 ? 'var(--positive)' : 'var(--negative)' }}
                    >
                      {row.pointsDelta >= 0 ? '+' : ''}
                      {formatNumber(row.pointsDelta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="tiny muted" style={{ margin: 0 }}>
        Looking for one customer? Open them from <Link to="/app/members">Members</Link> to see their full history.
      </p>
    </div>
  );
}

function labelFor(type: string): string {
  switch (type) {
    case 'earn': return 'Purchase';
    case 'redeem': return 'Reward redeemed';
    case 'adjust': return 'Manual adjustment';
    case 'signup_bonus': return 'Welcome bonus';
    case 'refund': return 'Points returned';
    case 'expire': return 'Points expired';
    default: return type;
  }
}
