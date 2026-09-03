import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, type Redemption } from '../lib/api';
import { Empty, ErrorNote, Sheet, Spinner, formatDate, formatPoints } from '../components/ui';

/** Every reward code the customer holds, across all their programmes. */
export function Rewards() {
  const [redemptions, setRedemptions] = useState<Redemption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showing, setShowing] = useState<Redemption | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ redemptions: Redemption[] }>('/customer/redemptions')
      .then((response) => {
        if (!cancelled) setRedemptions(response.redemptions);
      })
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!redemptions) return <Spinner />;

  const pending = redemptions.filter((entry) => entry.status === 'pending');
  const past = redemptions.filter((entry) => entry.status !== 'pending');

  if (redemptions.length === 0) {
    return (
      <Empty
        icon="🎁"
        title="No rewards yet"
        body="Once you swap points for a reward, the code to show at the counter lives here."
      />
    );
  }

  return (
    <div className="stack stack--lg">
      {pending.length > 0 ? (
        <section className="stack">
          <h2 className="section-title" style={{ margin: 0 }}>Ready to collect</h2>
          {pending.map((redemption) => (
            <button
              key={redemption.id}
              type="button"
              className="card row row--between"
              style={{ textAlign: 'left' }}
              onClick={() => setShowing(redemption)}
            >
              <div className="grow">
                <div className="strong truncate">{redemption.reward?.name}</div>
                <div className="tiny muted">
                  {redemption.merchant.name} · {formatPoints(redemption.pointsSpent)} points
                  {redemption.expiresAt ? ` · expires ${formatDate(redemption.expiresAt)}` : ''}
                </div>
              </div>
              <span
                className="pill"
                style={{ background: redemption.merchant.brandColor, color: '#fff' }}
              >
                {redemption.code}
              </span>
            </button>
          ))}
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="stack">
          <h2 className="section-title" style={{ margin: 0 }}>History</h2>
          <div className="list card">
            {past.map((redemption) => (
              <div key={redemption.id} className="list__item">
                <div className="grow">
                  <div className="strong small truncate">{redemption.reward?.name}</div>
                  <div className="tiny muted">
                    {redemption.merchant.name} · {formatDate(redemption.createdAt)}
                  </div>
                </div>
                <span className="pill tiny">{label(redemption.status)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showing ? (
        <Sheet title="Show this at the counter" onClose={() => setShowing(null)}>
          <div className="stack center">
            <p className="strong" style={{ margin: 0 }}>{showing.reward?.name}</p>
            <p className="small muted" style={{ margin: 0 }}>{showing.merchant.name}</p>
            <div className="qr">
              <QRCodeSVG value={showing.code} size={168} level="M" />
              <div className="code">{showing.code}</div>
            </div>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function label(status: string): string {
  switch (status) {
    case 'fulfilled':
      return 'Collected';
    case 'cancelled':
      return 'Cancelled';
    case 'expired':
      return 'Expired';
    default:
      return status;
  }
}
