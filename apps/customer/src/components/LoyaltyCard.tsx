import { Link } from 'react-router-dom';
import type { Membership } from '../lib/api';
import { formatPoints } from './ui';

/** The wallet card. Takes the merchant's own brand colour. */
export function LoyaltyCard({ membership }: { membership: Membership }) {
  const { merchant, tier, nextTier } = membership;
  const progress = nextTier
    ? Math.min(
        100,
        Math.round(
          ((membership.lifetimePoints - (tier?.minLifetimePoints ?? 0)) /
            Math.max(1, nextTier.minLifetimePoints - (tier?.minLifetimePoints ?? 0))) *
            100,
        ),
      )
    : 100;

  return (
    <Link
      to={`/card/${merchant.id}`}
      className="loyalty-card"
      style={{ ['--card-color' as string]: merchant.brandColor }}
    >
      <div className="row row--between">
        <span className="loyalty-card__brand">{merchant.name}</span>
        {tier ? <span className="pill" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>{tier.name}</span> : null}
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="loyalty-card__points">{formatPoints(membership.pointsBalance)}</div>
        <div className="loyalty-card__meta">points available</div>
      </div>

      <div className="stack stack--sm" style={{ marginTop: 16 }}>
        <div className="progress">
          <div className="progress__bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="loyalty-card__meta">
          {nextTier
            ? `${formatPoints(nextTier.pointsToGo)} points to ${nextTier.name}`
            : 'Top tier reached — enjoy every perk'}
        </div>
      </div>
    </Link>
  );
}
