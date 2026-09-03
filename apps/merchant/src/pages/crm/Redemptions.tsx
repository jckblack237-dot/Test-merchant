import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RedemptionRow } from '../../lib/api';
import { canAct, useSession } from '../../lib/session';
import { Empty, ErrorNote, Loading, formatDateTime, formatNumber } from '../../components/ui';
import { describeError } from '../site/SignUp';

const FILTERS = [
  ['pending', 'Waiting'],
  ['fulfilled', 'Collected'],
  ['cancelled', 'Cancelled'],
  ['all', 'Everything'],
] as const;

export function Redemptions() {
  const { user, subscription } = useSession();
  const [status, setStatus] = useState<string>('pending');
  const [rows, setRows] = useState<RedemptionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await api<{ redemptions: RedemptionRow[] }>(
      `/merchant/points/redemptions?status=${status}&limit=200`,
    );
    setRows(response.redemptions);
  }, [status]);

  useEffect(() => {
    setRows(null);
    load().catch((caught) => setError((caught as Error).message));
  }, [load]);

  async function act(id: string, action: 'fulfil' | 'cancel') {
    if (action === 'cancel' && !confirm('Cancel this redemption and return the points to the customer?')) {
      return;
    }
    setBusy(id);
    setError(null);
    try {
      await api(`/merchant/points/redemptions/${id}/${action}`, {
        method: 'POST',
        body: action === 'cancel' ? { reason: 'Cancelled by staff' } : {},
      });
      await load();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function lookupCode() {
    if (!code.trim()) return;
    setError(null);
    try {
      const response = await api<{ redemption: RedemptionRow }>(
        `/merchant/points/redemptions/code/${encodeURIComponent(code.trim().toUpperCase())}`,
      );
      setRows([response.redemption]);
      setStatus('all');
    } catch (caught) {
      setRows([]);
      setError(describeError(caught));
    }
  }

  return (
    <div className="stack">
      <div className="row row--between row--wrap">
        <div className="row" style={{ gap: 6 }}>
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn btn--sm ${status === value ? '' : 'btn--subtle'}`}
              onClick={() => { setCode(''); setStatus(value); }}
            >
              {label}
            </button>
          ))}
        </div>

        <form
          className="row"
          onSubmit={(event) => { event.preventDefault(); lookupCode(); }}
        >
          <input
            className="input mono"
            style={{ width: 180, textTransform: 'uppercase' }}
            placeholder="ABCD-1234"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-label="Look up a redemption code"
          />
          <button className="btn btn--sm btn--ghost" type="submit">Look up code</button>
        </form>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {!rows ? (
        <Loading rows={2} />
      ) : rows.length === 0 ? (
        <Empty
          icon="🎟️"
          title="Nothing here"
          body={
            status === 'pending'
              ? 'No rewards are waiting to be handed over right now.'
              : 'No redemptions match this filter.'
          }
        />
      ) : (
        <div className="card card--flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Reward</th>
                  <th>Customer</th>
                  <th className="right">Points</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono strong">{row.code}</td>
                    <td>{row.rewardName}</td>
                    <td>
                      <Link to={`/app/members/${row.membershipId}`} style={{ color: 'inherit' }}>
                        {row.customerName}
                      </Link>
                      <div className="tiny muted">{row.memberNumber}</div>
                    </td>
                    <td className="right tabular">{formatNumber(row.pointsSpent)}</td>
                    <td className="small muted">{formatDateTime(row.createdAt)}</td>
                    <td><StatusPill status={row.status} /></td>
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      {row.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={busy === row.id || !subscription.writable}
                            onClick={() => act(row.id, 'fulfil')}
                          >
                            Mark collected
                          </button>{' '}
                          {canAct(user.role, 'manager') ? (
                            <button
                              type="button"
                              className="btn btn--sm btn--danger"
                              disabled={busy === row.id}
                              onClick={() => act(row.id, 'cancel')}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'fulfilled' ? 'pill--positive'
      : status === 'cancelled' || status === 'expired' ? 'pill--negative'
        : 'pill--warning';
  const label =
    status === 'fulfilled' ? 'Collected'
      : status === 'pending' ? 'Waiting'
        : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`pill ${tone}`}>{label}</span>;
}
