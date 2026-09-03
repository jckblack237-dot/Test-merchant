import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type CatalogItem, type LedgerEntry, type Member } from '../../lib/api';
import { useSession } from '../../lib/session';
import { ErrorNote, formatMoney, formatNumber, initials } from '../../components/ui';
import { describeError } from '../site/SignUp';

interface LookupResponse {
  member: Member & { tier: { name: string; color: string } | null };
  pendingRedemptions: { id: string; code: string; pointsSpent: number; rewardName: string }[];
  recentActivity: LedgerEntry[];
}

interface AwardResponse {
  breakdown: { total: number; tierMultiplier: number; campaignMultiplier: number; appliedCampaigns: { name: string }[] };
  member: Member;
  tierUpgradedTo: { name: string } | null;
}

/**
 * The till screen. Find the customer, type the amount, award the points.
 * Optimised for one-handed use on a tablet next to the card machine.
 */
export function Counter() {
  const { merchant, subscription } = useSession();
  const [searchParams] = useSearchParams();
  const [identifier, setIdentifier] = useState(searchParams.get('member') ?? '');
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [amount, setAmount] = useState('');
  const [locations, setLocations] = useState<CatalogItem[]>([]);
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AwardResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ items: CatalogItem[] }>('/merchant/catalog/locations')
      .then((response) => {
        setLocations(response.items);
        if (response.items.length === 1) setLocationId(String(response.items[0]!.id));
      })
      .catch(() => setLocations([]));
  }, []);

  async function find(event?: FormEvent) {
    event?.preventDefault();
    if (!identifier.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // A scanned wallet code is a signed token; anything else is typed by staff.
      const value = identifier.trim();
      const body = value.startsWith('mem_')
        ? { qrToken: value }
        : value.includes('@')
          ? { email: value }
          : { memberNumber: value };
      const response = await api<LookupResponse>('/merchant/points/lookup', { method: 'POST', body });
      setLookup(response);
      setTimeout(() => amountRef.current?.focus(), 0);
    } catch (caught) {
      setLookup(null);
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function award(event: FormEvent) {
    event.preventDefault();
    if (!lookup) return;
    const cents = Math.round(Number.parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Enter the amount the customer paid.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api<AwardResponse>('/merchant/points/award', {
        method: 'POST',
        body: {
          membershipId: lookup.member.id,
          amountCents: cents,
          locationId: locationId || undefined,
        },
      });
      setResult(response);
      setAmount('');
      setLookup({ ...lookup, member: { ...lookup.member, ...response.member } });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function fulfil(redemptionId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/merchant/points/redemptions/${redemptionId}/fulfil`, {
        method: 'POST',
        body: { locationId: locationId || undefined },
      });
      await find();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 380px)' }}>
      <div className="stack">
        <section className="card stack">
          <h2 style={{ margin: 0, fontSize: 15 }}>Find the customer</h2>
          <form className="row" onSubmit={find}>
            <input
              className="input grow"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="Scan their code, or type member number / email"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              aria-label="Member number, email or scanned code"
            />
            <button className="btn" type="submit" disabled={busy}>
              {busy && !lookup ? 'Looking…' : 'Find'}
            </button>
          </form>
          <p className="tiny muted" style={{ margin: 0 }}>
            A barcode scanner works here too — it types the customer's code and presses enter.
          </p>
        </section>

        {error ? <ErrorNote message={error} /> : null}

        {!subscription.writable ? (
          <div className="alert alert--warning">
            {subscription.reason ?? 'Your subscription is inactive.'}{' '}
            <Link to="/app/billing">Choose a plan</Link> to start awarding points again.
          </div>
        ) : null}

        {lookup ? (
          <section className="card stack">
            <div className="row row--between row--wrap">
              <div className="row">
                <span className="avatar" style={{ width: 44, height: 44, fontSize: 15 }} aria-hidden="true">
                  {initials(lookup.member.name)}
                </span>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <Link
                      to={`/app/members/${lookup.member.id}`}
                      className="strong"
                      style={{ color: 'inherit', textDecoration: 'none', fontSize: 16 }}
                    >
                      {lookup.member.name}
                    </Link>
                    {lookup.member.tier ? (
                      <span
                        className="pill"
                        style={{
                          background: `color-mix(in srgb, ${lookup.member.tier.color} 20%, transparent)`,
                          color: lookup.member.tier.color,
                        }}
                      >
                        {lookup.member.tier.name}
                      </span>
                    ) : null}
                  </div>
                  <div className="tiny muted">
                    {lookup.member.memberNumber} · {formatNumber(lookup.member.visits)} visits
                  </div>
                </div>
              </div>
              <div className="right">
                <div className="stat__label">Balance</div>
                <div className="stat__value" style={{ fontSize: 24 }}>
                  {formatNumber(lookup.member.pointsBalance)}
                </div>
              </div>
            </div>

            <form className="stack" onSubmit={award}>
              <div className="row row--wrap" style={{ alignItems: 'flex-end' }}>
                <label className="field grow" style={{ minWidth: 160 }}>
                  <span className="field__label">Amount paid ({merchant.currency})</span>
                  <input
                    ref={amountRef}
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    style={{ fontSize: 20, fontWeight: 600 }}
                    required
                  />
                </label>

                {locations.length > 1 ? (
                  <label className="field" style={{ minWidth: 170 }}>
                    <span className="field__label">Location</span>
                    <select
                      className="select"
                      value={locationId}
                      onChange={(event) => setLocationId(event.target.value)}
                    >
                      <option value="">Not specified</option>
                      {locations.map((location) => (
                        <option key={String(location.id)} value={String(location.id)}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <button
                  className="btn btn--lg"
                  type="submit"
                  disabled={busy || !subscription.writable || lookup.member.status === 'blocked'}
                >
                  {busy ? 'Awarding…' : 'Award points'}
                </button>
              </div>
            </form>

            {lookup.member.status === 'blocked' ? (
              <div className="alert">This member is blocked and cannot earn points.</div>
            ) : null}

            {result ? (
              <div className="alert alert--success stack stack--sm">
                <span className="strong">
                  +{formatNumber(result.breakdown.total)} points awarded · new balance{' '}
                  {formatNumber(result.member.pointsBalance)}
                </span>
                {result.breakdown.tierMultiplier > 1 ? (
                  <span className="tiny">Tier multiplier {result.breakdown.tierMultiplier}x applied.</span>
                ) : null}
                {result.breakdown.appliedCampaigns.length > 0 ? (
                  <span className="tiny">
                    Campaign: {result.breakdown.appliedCampaigns.map((c) => c.name).join(', ')}
                  </span>
                ) : null}
                {result.tierUpgradedTo ? (
                  <span className="tiny strong">
                    🎉 They just reached {result.tierUpgradedTo.name} — worth telling them.
                  </span>
                ) : null}
              </div>
            ) : null}

            {lookup.pendingRedemptions.length > 0 ? (
              <div className="stack stack--sm">
                <span className="field__label">Rewards waiting to be collected</span>
                {lookup.pendingRedemptions.map((redemption) => (
                  <div key={redemption.id} className="row row--between card" style={{ padding: 12 }}>
                    <div className="grow">
                      <div className="strong small">{redemption.rewardName}</div>
                      <div className="tiny muted mono">{redemption.code}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => fulfil(redemption.id)}
                      disabled={busy || !subscription.writable}
                    >
                      Mark collected
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <aside className="stack">
        {lookup ? (
          <section className="card stack stack--sm">
            <h3 style={{ margin: 0, fontSize: 15 }}>Recent visits</h3>
            {lookup.recentActivity.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>First visit — say hello.</p>
            ) : (
              lookup.recentActivity.map((entry) => (
                <div key={entry.id} className="row row--between small">
                  <span className="muted">
                    {new Date(entry.createdAt).toLocaleDateString(undefined, {
                      day: 'numeric', month: 'short',
                    })}
                    {entry.amountCents > 0 ? ` · ${formatMoney(entry.amountCents, merchant.currency)}` : ''}
                  </span>
                  <span
                    className="tabular strong"
                    style={{ color: entry.pointsDelta >= 0 ? 'var(--positive)' : 'var(--negative)' }}
                  >
                    {entry.pointsDelta >= 0 ? '+' : ''}
                    {formatNumber(entry.pointsDelta)}
                  </span>
                </div>
              ))
            )}
          </section>
        ) : (
          <section className="card stack stack--sm">
            <h3 style={{ margin: 0, fontSize: 15 }}>How this works</h3>
            <ol className="small muted stack stack--sm" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Ask the customer to open their wallet and show their code.</li>
              <li>Scan it, or type their member number or email.</li>
              <li>Enter what they paid and press Award points.</li>
            </ol>
            <p className="tiny muted" style={{ margin: 0 }}>
              Not a member yet? <Link to="/app/members">Sign them up</Link> — it takes their name and
              email, and they get the welcome bonus straight away.
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}
