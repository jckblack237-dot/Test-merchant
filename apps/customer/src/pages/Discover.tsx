import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Membership, type Merchant } from '../lib/api';
import { Empty, ErrorNote, Spinner, initials } from '../components/ui';

/** Public directory of every programme a customer can join. */
export function Discover() {
  const navigate = useNavigate();
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [directory, wallet] = await Promise.all([
          api<{ merchants: Merchant[] }>('/merchants'),
          api<{ wallet: Membership[] }>('/customer/wallet'),
        ]);
        if (cancelled) return;
        setMerchants(directory.merchants);
        setJoinedIds(new Set(wallet.wallet.map((entry) => entry.merchant.id)));
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!merchants) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return merchants;
    return merchants.filter((merchant) =>
      `${merchant.name} ${merchant.tagline} ${merchant.category}`.toLowerCase().includes(needle),
    );
  }, [merchants, query]);

  async function join(merchant: Merchant) {
    setJoining(merchant.id);
    setError(null);
    try {
      await api(`/customer/merchants/${merchant.id}/join`, { method: 'POST' });
      navigate(`/card/${merchant.id}`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setJoining(null);
    }
  }

  if (error && !merchants) return <ErrorNote message={error} />;
  if (!merchants) return <Spinner />;

  return (
    <div className="stack">
      <input
        className="input"
        placeholder="Search cafés, bakeries, brands…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search rewards programmes"
      />

      {error ? <ErrorNote message={error} /> : null}

      {filtered.length === 0 ? (
        <Empty icon="🔍" title="Nothing matched" body="Try a different name or clear the search." />
      ) : (
        <div className="stack">
          {filtered.map((merchant) => {
            const joined = joinedIds.has(merchant.id);
            return (
              <article key={merchant.id} className="card stack stack--sm">
                <div className="row">
                  <div
                    className="avatar"
                    style={{ background: merchant.brandColor, color: '#fff' }}
                    aria-hidden="true"
                  >
                    {initials(merchant.name)}
                  </div>
                  <div className="grow">
                    <div className="strong truncate">{merchant.name}</div>
                    <div className="tiny muted truncate">
                      {merchant.tagline || merchant.category}
                    </div>
                  </div>
                </div>

                <p className="small muted" style={{ margin: 0 }}>
                  {merchant.description || 'Collect points on every order.'}
                </p>

                <div className="row row--between">
                  <span className="tiny muted">
                    {merchant.locationCount ?? 0} location{merchant.locationCount === 1 ? '' : 's'}
                    {merchant.signupBonusPoints > 0
                      ? ` · ${merchant.signupBonusPoints} points to join`
                      : ''}
                  </span>
                  {joined ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--subtle"
                      onClick={() => navigate(`/card/${merchant.id}`)}
                    >
                      Open card
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={joining === merchant.id}
                      onClick={() => join(merchant)}
                    >
                      {joining === merchant.id ? 'Joining…' : 'Join'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
