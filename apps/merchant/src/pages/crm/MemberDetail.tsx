import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type LedgerEntry, type Member } from '../../lib/api';
import { canAct, useSession } from '../../lib/session';
import {
  ErrorNote, Loading, Modal, Stat, formatDate, formatDateTime, formatMoney, formatNumber, initials,
} from '../../components/ui';
import { describeError } from '../site/SignUp';

interface MemberDetailResponse {
  member: Member & {
    notes: string;
    tags: string[];
    customerSince: string;
    tier: { id: string; name: string; color: string; perks: string[] } | null;
    nextTier: { name: string; pointsToGo: number } | null;
  };
  ledger: LedgerEntry[];
  redemptions: {
    id: string; code: string; status: string; pointsSpent: number; rewardName: string;
    createdAt: string; fulfilledAt: string | null;
  }[];
}

export function MemberDetail() {
  const { id = '' } = useParams();
  const { merchant, user, subscription } = useSession();
  const [data, setData] = useState<MemberDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  const load = useCallback(async () => {
    const response = await api<MemberDetailResponse>(`/merchant/members/${id}`);
    setData(response);
    setNotes(response.member.notes);
  }, [id]);

  useEffect(() => {
    load().catch((caught) => setError((caught as Error).message));
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading rows={4} />;

  const { member, ledger, redemptions } = data;
  const canManage = canAct(user.role, 'manager');

  async function saveNotes() {
    setSavingNotes(true);
    setNotesSaved(false);
    try {
      await api(`/merchant/members/${id}`, { method: 'PATCH', body: { notes } });
      setNotesSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSavingNotes(false);
    }
  }

  async function toggleBlocked() {
    try {
      await api(`/merchant/members/${id}`, {
        method: 'PATCH',
        body: { status: member.status === 'blocked' ? 'active' : 'blocked' },
      });
      await load();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <div className="stack stack--lg">
      <div className="row row--between row--wrap">
        <div className="row">
          <span className="avatar" style={{ width: 46, height: 46, fontSize: 16 }} aria-hidden="true">
            {initials(member.name)}
          </span>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 19 }}>{member.name}</h2>
              {member.tier ? (
                <span
                  className="pill"
                  style={{
                    background: `color-mix(in srgb, ${member.tier.color} 20%, transparent)`,
                    color: member.tier.color,
                  }}
                >
                  {member.tier.name}
                </span>
              ) : null}
              {member.status === 'blocked' ? <span className="pill pill--negative">Blocked</span> : null}
            </div>
            <div className="small muted">
              {member.email}
              {member.phone ? ` · ${member.phone}` : ''} · member {member.memberNumber}
            </div>
          </div>
        </div>

        <div className="row">
          <Link className="btn btn--ghost btn--sm" to={`/app/counter?member=${member.memberNumber}`}>
            Award points
          </Link>
          {canManage ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setAdjusting(true)}
              disabled={!subscription.writable}
            >
              Adjust balance
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid--4">
        <Stat label="Points balance" value={formatNumber(member.pointsBalance)} />
        <Stat
          label="Lifetime points"
          value={formatNumber(member.lifetimePoints)}
          note={member.nextTier ? `${formatNumber(member.nextTier.pointsToGo)} to ${member.nextTier.name}` : 'Top tier'}
        />
        <Stat label="Visits" value={formatNumber(member.visits)} />
        <Stat
          label="Total spend"
          value={formatMoney(member.totalSpendCents, merchant.currency)}
          note={`Member since ${formatDate(member.joinedAt)}`}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
        <section className="card card--flush">
          <div className="row row--between" style={{ padding: '14px 18px' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Points history</h3>
            <span className="pill">{ledger.length} entries</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Activity</th>
                  <th className="right">Points</th>
                  <th className="right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td>
                      <div className="small">{describeEntry(entry)}</div>
                      {entry.amountCents > 0 ? (
                        <div className="tiny muted">
                          {formatMoney(entry.amountCents, merchant.currency)}
                          {entry.locationName ? ` · ${entry.locationName}` : ''}
                          {entry.reference ? ` · ref ${entry.reference}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td
                      className="right tabular strong"
                      style={{ color: entry.pointsDelta >= 0 ? 'var(--positive)' : 'var(--negative)' }}
                    >
                      {entry.pointsDelta >= 0 ? '+' : ''}
                      {formatNumber(entry.pointsDelta)}
                    </td>
                    <td className="right tabular muted">{formatNumber(entry.balanceAfter)}</td>
                  </tr>
                ))}
                {ledger.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="center muted small" style={{ padding: 30 }}>
                      Nothing recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className="stack">
          <section className="card stack stack--sm">
            <h3 style={{ margin: 0, fontSize: 15 }}>Private notes</h3>
            <p className="tiny muted" style={{ margin: 0 }}>
              Only your team sees these. The customer never does, and neither does any other business
              on LoyaltyLoop.
            </p>
            <textarea
              className="textarea"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setNotesSaved(false);
              }}
              placeholder="Oat flat white, no sugar. Comes in most mornings before 9."
              disabled={!canManage}
            />
            {canManage ? (
              <div className="row row--between">
                {notesSaved ? <span className="tiny" style={{ color: 'var(--positive)' }}>Saved</span> : <span />}
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={saveNotes}
                  disabled={savingNotes || notes === member.notes}
                >
                  {savingNotes ? 'Saving…' : 'Save notes'}
                </button>
              </div>
            ) : null}
          </section>

          <section className="card stack stack--sm">
            <h3 style={{ margin: 0, fontSize: 15 }}>Rewards claimed</h3>
            {redemptions.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>No rewards redeemed yet.</p>
            ) : (
              redemptions.map((redemption) => (
                <div key={redemption.id} className="row row--between small">
                  <span className="grow truncate">{redemption.rewardName}</span>
                  <span className="pill">{redemption.status}</span>
                </div>
              ))
            )}
          </section>

          {canManage ? (
            <button type="button" className="btn btn--danger btn--sm" onClick={toggleBlocked}>
              {member.status === 'blocked' ? 'Unblock this member' : 'Block from earning points'}
            </button>
          ) : null}
        </div>
      </div>

      {adjusting ? (
        <AdjustModal
          memberId={id}
          balance={member.pointsBalance}
          onClose={() => setAdjusting(false)}
          onDone={async () => {
            setAdjusting(false);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function AdjustModal({
  memberId, balance, onClose, onDone,
}: { memberId: string; balance: number; onClose: () => void; onDone: () => void }) {
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = Number.parseInt(points, 10);

  return (
    <Modal title="Adjust points balance" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api('/merchant/points/adjust', {
              method: 'POST',
              body: { membershipId: memberId, points: parsed, note },
            });
            onDone();
          } catch (caught) {
            setError(describeError(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="small muted" style={{ margin: 0 }}>
          Current balance: <strong>{formatNumber(balance)}</strong> points. Use a negative number to
          take points away. Every adjustment is recorded in your audit log with your name on it.
        </p>

        <label className="field">
          <span className="field__label">Points to add or remove</span>
          <input
            className="input"
            type="number"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            placeholder="e.g. 50 or -20"
            required
          />
          {Number.isFinite(parsed) && parsed !== 0 ? (
            <span className="field__hint">New balance will be {formatNumber(balance + parsed)}.</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Reason</span>
          <input
            className="input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Goodwill for a spilled drink"
            minLength={3}
            required
          />
        </label>

        {error ? <ErrorNote message={error} /> : null}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !Number.isFinite(parsed) || parsed === 0}>
            {busy ? 'Applying…' : 'Apply adjustment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function describeEntry(entry: LedgerEntry): string {
  if (entry.note) return entry.note;
  switch (entry.type) {
    case 'earn':
      return entry.items.length > 0 ? entry.items.map((item) => item.name).join(', ') : 'Purchase';
    case 'redeem':
      return 'Reward redeemed';
    case 'signup_bonus':
      return 'Welcome bonus';
    case 'adjust':
      return 'Manual adjustment';
    case 'refund':
      return 'Points returned';
    case 'expire':
      return 'Points expired';
    default:
      return entry.type;
  }
}
