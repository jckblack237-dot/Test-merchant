import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Member } from '../../lib/api';
import { useSession } from '../../lib/session';
import {
  Empty, ErrorNote, Loading, Modal, formatMoney, formatNumber, formatRelative, initials,
} from '../../components/ui';
import { describeError } from '../site/SignUp';

const SORTS = [
  ['recent', 'Recently active'],
  ['lifetime', 'Most points earned'],
  ['spend', 'Highest spend'],
  ['joined', 'Newest members'],
  ['name', 'Name'],
] as const;

export function Members() {
  const { merchant, subscription } = useSession();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<string>('recent');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ sort, limit: '100' });
    if (query.trim()) params.set('q', query.trim());
    const response = await api<{ members: Member[]; pagination: { total: number } }>(
      `/merchant/members?${params}`,
    );
    setMembers(response.members);
    setTotal(response.pagination.total);
  }, [query, sort]);

  useEffect(() => {
    // Debounce so typing in the search box doesn't fire a request per keystroke.
    const timer = setTimeout(() => {
      load().catch((caught) => setError((caught as Error).message));
    }, 220);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="stack">
      <div className="row row--between row--wrap">
        <div className="row row--wrap grow" style={{ maxWidth: 620 }}>
          <input
            className="input grow"
            style={{ maxWidth: 320 }}
            placeholder="Search name, email, phone or member number"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search members"
          />
          <select
            className="select"
            style={{ width: 'auto' }}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort members"
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="row">
          <a className="btn btn--ghost btn--sm" href="/api/merchant/members/export/csv" download>
            Export CSV
          </a>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setAdding(true)}
            disabled={!subscription.writable}
          >
            Add member
          </button>
        </div>
      </div>

      {error ? <ErrorNote message={error} onRetry={() => load().catch(() => {})} /> : null}

      {!members ? (
        <Loading />
      ) : members.length === 0 ? (
        <Empty
          icon="👥"
          title={query ? 'No members matched' : 'No members yet'}
          body={
            query
              ? 'Try a different name, email or member number.'
              : 'Sign your first customer up at the counter, or let them join from the app.'
          }
        />
      ) : (
        <div className="card card--flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Tier</th>
                  <th className="right">Points</th>
                  <th className="right">Lifetime</th>
                  <th className="right">Visits</th>
                  <th className="right">Spend</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr
                    key={member.id}
                    className="clickable"
                    onClick={() => navigate(`/app/members/${member.id}`)}
                  >
                    <td>
                      <div className="row">
                        <span className="avatar" aria-hidden="true">{initials(member.name)}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="strong truncate">
                            {member.name}
                            {member.status === 'blocked' ? (
                              <span className="pill pill--negative" style={{ marginLeft: 6 }}>Blocked</span>
                            ) : null}
                          </div>
                          <div className="tiny muted truncate">
                            {member.email} · {member.memberNumber}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {member.tierName ? (
                        <span
                          className="pill"
                          style={{
                            background: `color-mix(in srgb, ${member.tierColor} 20%, transparent)`,
                            color: member.tierColor ?? undefined,
                          }}
                        >
                          {member.tierName}
                        </span>
                      ) : (
                        <span className="muted tiny">—</span>
                      )}
                    </td>
                    <td className="right tabular strong">{formatNumber(member.pointsBalance)}</td>
                    <td className="right tabular muted">{formatNumber(member.lifetimePoints)}</td>
                    <td className="right tabular muted">{formatNumber(member.visits)}</td>
                    <td className="right tabular muted">
                      {formatMoney(member.totalSpendCents, merchant.currency)}
                    </td>
                    <td className="small muted">{formatRelative(member.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {members && members.length > 0 ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          Showing {members.length} of {formatNumber(total)} members.{' '}
          <Link to="/app/counter">Award points at the counter →</Link>
        </p>
      ) : null}

      {adding ? (
        <AddMemberModal
          onClose={() => setAdding(false)}
          onCreated={(member) => {
            setAdding(false);
            navigate(`/app/members/${member.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

function AddMemberModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (member: Member) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Sign up a customer" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const response = await api<{ member: Member }>('/merchant/members', {
              method: 'POST',
              body: { name, email, phone: phone || undefined },
            });
            onCreated(response.member);
          } catch (caught) {
            setError(describeError(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span className="field__label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <span className="field__hint">
            They'll use this to sign in to the customer app and see their points.
          </span>
        </label>
        <label className="field">
          <span className="field__label">Phone (optional)</span>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>

        {error ? <ErrorNote message={error} /> : null}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
