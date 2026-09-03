import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  api, type ActivityEntry, type Location, type Membership, type Product, type Reward,
} from '../lib/api';
import { Empty, ErrorNote, Sheet, Spinner, formatMoney, formatPoints, formatRelative } from '../components/ui';

interface CatalogResponse {
  locations: Location[];
  products: Product[];
  rewards: Reward[];
}

type Tab = 'rewards' | 'menu' | 'shops' | 'activity';

export function CardDetail() {
  const { merchantId = '' } = useParams();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [tab, setTab] = useState<Tab>('rewards');
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [confirming, setConfirming] = useState<Reward | null>(null);
  const [redeemed, setRedeemed] = useState<{ code: string; rewardName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [membershipResponse, catalogResponse, activityResponse] = await Promise.all([
      api<{ membership: Membership }>(`/customer/merchants/${merchantId}/membership`),
      api<CatalogResponse>(`/customer/merchants/${merchantId}/catalog`),
      api<{ activity: ActivityEntry[] }>(`/customer/merchants/${merchantId}/activity?limit=50`),
    ]);
    setMembership(membershipResponse.membership);
    setCatalog(catalogResponse);
    setActivity(activityResponse.activity);
  }, [merchantId]);

  useEffect(() => {
    let cancelled = false;
    load().catch((caught) => {
      if (!cancelled) setError((caught as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function redeem(reward: Reward) {
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ redemption: { code: string } }>(
        `/customer/merchants/${merchantId}/redeem`,
        { method: 'POST', body: { rewardId: reward.id } },
      );
      setConfirming(null);
      setRedeemed({ code: response.redemption.code, rewardName: reward.name });
      await load();
    } catch (caught) {
      setError((caught as Error).message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  if (error && !membership) return <ErrorNote message={error} />;
  if (!membership || !catalog) return <Spinner />;

  const { merchant, tier, nextTier } = membership;
  const progress = nextTier
    ? Math.min(
        100,
        Math.round(
          ((membership.lifetimePoints - (tier?.minLifetimePoints ?? 0)) /
            Math.max(1, nextTier.minLifetimePoints - (tier?.minLifetimePoints ?? 0))) * 100,
        ),
      )
    : 100;

  return (
    <div className="stack stack--lg" style={{ ['--brand' as string]: merchant.brandColor }}>
      <section
        className="loyalty-card"
        style={{ ['--card-color' as string]: merchant.brandColor }}
        aria-label={`${merchant.name} loyalty card`}
      >
        <div className="row row--between">
          <span className="loyalty-card__brand">{merchant.name}</span>
          {tier ? (
            <span className="pill" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>
              {tier.name}
            </span>
          ) : null}
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="loyalty-card__points">{formatPoints(membership.pointsBalance)}</div>
          <div className="loyalty-card__meta">points available · member {membership.memberNumber}</div>
        </div>

        <div className="stack stack--sm" style={{ marginTop: 16 }}>
          <div className="progress">
            <div className="progress__bar" style={{ width: `${progress}%` }} />
          </div>
          <div className="loyalty-card__meta">
            {nextTier
              ? `${formatPoints(nextTier.pointsToGo)} points to ${nextTier.name}`
              : 'Top tier reached'}
          </div>
        </div>
      </section>

      <button type="button" className="btn btn--block" onClick={() => setShowQr(true)}>
        Show my code to collect points
      </button>

      {error ? <ErrorNote message={error} /> : null}

      {tier && tier.perks.length > 0 ? (
        <div className="card stack stack--sm">
          <div className="strong">{tier.name} perks</div>
          <ul className="stack stack--sm small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {tier.perks.map((perk) => (
              <li key={perk}>{perk}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="row" role="tablist" aria-label="Card sections" style={{ gap: 6, flexWrap: 'wrap' }}>
        {(
          [
            ['rewards', 'Rewards'],
            ['menu', 'Menu'],
            ['shops', 'Shops'],
            ['activity', 'Activity'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`btn btn--sm ${tab === value ? '' : 'btn--subtle'}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'rewards' ? (
        catalog.rewards.length === 0 ? (
          <Empty icon="🎁" title="No rewards yet" body="This shop hasn't published its rewards." />
        ) : (
          <div className="reward-grid">
            {catalog.rewards.map((reward) => {
              const affordable = membership.pointsBalance >= reward.pointsCost;
              return (
                <button
                  key={reward.id}
                  type="button"
                  className={`reward ${affordable ? '' : 'reward--locked'}`}
                  disabled={!affordable}
                  onClick={() => setConfirming(reward)}
                >
                  <span className="strong small">{reward.name}</span>
                  <span className="tiny muted">{reward.description}</span>
                  <span className="reward__cost small">{formatPoints(reward.pointsCost)} pts</span>
                  {!affordable ? (
                    <span className="tiny muted">
                      {formatPoints(reward.pointsCost - membership.pointsBalance)} more to go
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )
      ) : null}

      {tab === 'menu' ? (
        <div className="list card">
          {catalog.products.map((product) => (
            <div key={product.id} className="list__item">
              <div className="grow">
                <div className="strong small">
                  {product.name} {product.isFeatured ? <span className="pill tiny">Popular</span> : null}
                </div>
                <div className="tiny muted truncate">{product.description}</div>
              </div>
              <div className="small tabular">{formatMoney(product.priceCents, merchant.currency)}</div>
            </div>
          ))}
          {catalog.products.length === 0 ? <p className="muted small">No menu published yet.</p> : null}
        </div>
      ) : null}

      {tab === 'shops' ? (
        <div className="list card">
          {catalog.locations.map((location) => (
            <div key={location.id} className="list__item">
              <div className="grow">
                <div className="strong small">{location.name}</div>
                <div className="tiny muted">
                  {[location.addressLine1, location.city].filter(Boolean).join(', ')}
                </div>
                {location.openingHours ? <div className="tiny muted">{location.openingHours}</div> : null}
              </div>
              {location.phone ? (
                <a className="btn btn--sm btn--subtle" href={`tel:${location.phone}`}>
                  Call
                </a>
              ) : null}
            </div>
          ))}
          {catalog.locations.length === 0 ? <p className="muted small">No shops listed yet.</p> : null}
        </div>
      ) : null}

      {tab === 'activity' ? (
        activity.length === 0 ? (
          <Empty icon="🧾" title="No activity yet" body="Your points history will appear here." />
        ) : (
          <div className="list card">
            {activity.map((entry) => (
              <div key={entry.id} className="list__item">
                <div className="grow">
                  <div className="strong small">{describe(entry)}</div>
                  <div className="tiny muted">
                    {formatRelative(entry.createdAt)}
                    {entry.amountCents > 0 ? ` · ${formatMoney(entry.amountCents, merchant.currency)}` : ''}
                  </div>
                </div>
                <div className={`delta ${entry.pointsDelta >= 0 ? 'delta--up' : 'delta--down'}`}>
                  {entry.pointsDelta >= 0 ? '+' : ''}
                  {formatPoints(entry.pointsDelta)}
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      <Link className="btn btn--ghost btn--block" to="/">
        Back to wallet
      </Link>

      {showQr ? (
        <QrSheet
          merchantId={merchantId}
          memberNumber={membership.memberNumber}
          brandColor={merchant.brandColor}
          onClose={() => setShowQr(false)}
        />
      ) : null}

      {confirming ? (
        <Sheet title="Redeem reward" onClose={() => setConfirming(null)}>
          <div className="stack">
            <div className="card stack stack--sm">
              <span className="strong">{confirming.name}</span>
              <span className="small muted">{confirming.description}</span>
              <span className="reward__cost">{formatPoints(confirming.pointsCost)} points</span>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              You'll get a code to show at the counter. Your balance after this: {' '}
              <strong>{formatPoints(membership.pointsBalance - confirming.pointsCost)}</strong> points.
            </p>
            <button className="btn btn--block" type="button" disabled={busy} onClick={() => redeem(confirming)}>
              {busy ? 'Redeeming…' : 'Confirm and get my code'}
            </button>
          </div>
        </Sheet>
      ) : null}

      {redeemed ? (
        <Sheet title="Show this at the counter" onClose={() => setRedeemed(null)}>
          <div className="stack center">
            <p className="strong" style={{ margin: 0 }}>{redeemed.rewardName}</p>
            <div className="qr">
              <QRCodeSVG value={redeemed.code} size={168} level="M" />
              <div className="code">{redeemed.code}</div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Staff will scan or type this code. You can find it again under Rewards.
            </p>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

/** Fetches a short-lived signed token and refreshes it before it expires. */
function QrSheet({
  merchantId, memberNumber, brandColor, onClose,
}: { merchantId: string; memberNumber: string; brandColor: string; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const fetchToken = async () => {
      try {
        const response = await api<{ token: string; expiresInSeconds: number }>(
          `/customer/merchants/${merchantId}/qr`,
        );
        if (cancelled) return;
        setToken(response.token);
        setSecondsLeft(response.expiresInSeconds);
        // Renew a little before expiry so the code on screen always works.
        timer = setTimeout(fetchToken, (response.expiresInSeconds - 10) * 1000);
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      }
    };

    fetchToken();
    const tick = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [merchantId]);

  return (
    <Sheet title="Collect points" onClose={onClose}>
      <div className="stack center">
        {error ? <ErrorNote message={error} /> : null}
        <div className="qr">
          {token ? (
            <QRCodeSVG value={token} size={200} level="M" fgColor="#16181a" />
          ) : (
            <div className="skeleton" style={{ width: 200, height: 200 }} />
          )}
          <div className="qr__number" style={{ color: brandColor }}>
            {memberNumber}
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Show this at the till. The code refreshes every couple of minutes
          {secondsLeft > 0 ? ` (${secondsLeft}s)` : ''} so a screenshot can't be reused.
        </p>
      </div>
    </Sheet>
  );
}

function describe(entry: ActivityEntry): string {
  if (entry.note) return entry.note;
  switch (entry.type) {
    case 'earn':
      return entry.items.length > 0 ? entry.items.map((item) => item.name).join(', ') : 'Purchase';
    case 'redeem':
      return 'Reward redeemed';
    case 'signup_bonus':
      return 'Welcome bonus';
    case 'adjust':
      return 'Points adjusted by staff';
    case 'refund':
      return 'Points returned';
    case 'expire':
      return 'Points expired';
    default:
      return 'Activity';
  }
}
