import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Membership, type Redemption } from '../lib/api';
import { LoyaltyCard } from '../components/LoyaltyCard';
import { Empty, ErrorNote, Spinner, formatPoints } from '../components/ui';

interface WalletResponse {
  wallet: Membership[];
  totals: { programmes: number; pointsAcrossProgrammes: number };
}

export function Wallet() {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [pending, setPending] = useState<Redemption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wallet, redemptions] = await Promise.all([
          api<WalletResponse>('/customer/wallet'),
          api<{ redemptions: Redemption[] }>('/customer/redemptions'),
        ]);
        if (cancelled) return;
        setData(wallet);
        setPending(redemptions.redemptions.filter((entry) => entry.status === 'pending'));
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Spinner />;

  if (data.wallet.length === 0) {
    return (
      <Empty
        icon="☕"
        title="Your wallet is empty"
        body="Find a café near you and start collecting points on your very next order."
        action={
          <Link className="btn" to="/discover">
            Browse rewards programmes
          </Link>
        }
      />
    );
  }

  return (
    <div className="stack stack--lg">
      <div className="card row row--between">
        <div>
          <div className="tiny muted">Points across all programmes</div>
          <div className="strong tabular" style={{ fontSize: 26 }}>
            {formatPoints(data.totals.pointsAcrossProgrammes)}
          </div>
        </div>
        <div className="pill">{data.totals.programmes} cards</div>
      </div>

      {pending.length > 0 ? (
        <div className="stack stack--sm">
          <h2 className="section-title" style={{ margin: 0 }}>
            Ready to collect
          </h2>
          {pending.map((redemption) => (
            <Link
              key={redemption.id}
              to="/rewards"
              className="card row row--between"
              style={{ textDecoration: 'none' }}
            >
              <div className="grow">
                <div className="strong truncate">{redemption.reward?.name}</div>
                <div className="tiny muted">{redemption.merchant.name}</div>
              </div>
              <span className="pill" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
                {redemption.code}
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="stack">
        <h2 className="section-title" style={{ margin: 0 }}>
          Your cards
        </h2>
        {data.wallet.map((membership) => (
          <LoyaltyCard key={membership.id} membership={membership} />
        ))}
      </div>

      <Link className="btn btn--ghost btn--block" to="/discover">
        Find another programme
      </Link>
    </div>
  );
}
