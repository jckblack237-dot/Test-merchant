import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Dashboard as DashboardData } from '../../lib/api';
import { useSession } from '../../lib/session';
import {
  Empty, ErrorNote, LineChart, Loading, Stat, formatMoney, formatNumber, initials,
} from '../../components/ui';

const RANGES = [7, 30, 90] as const;

export function Dashboard() {
  const { merchant } = useSession();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api<DashboardData>(`/merchant/dashboard?days=${days}`)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading rows={4} />;

  const currency = merchant.currency;
  const maxLocationRevenue = Math.max(1, ...data.byLocation.map((row) => row.revenueCents));
  const totalTierMembers = Math.max(1, data.tiers.reduce((sum, tier) => sum + tier.memberCount, 0));

  return (
    <div className="stack stack--lg">
      <div className="row row--between row--wrap">
        <p className="muted small" style={{ margin: 0 }}>
          How your programme performed over the last {days} days.
        </p>
        <div className="row" style={{ gap: 6 }}>
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              className={`btn btn--sm ${days === range ? '' : 'btn--subtle'}`}
              onClick={() => setDays(range)}
            >
              {range}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid--4">
        <Stat
          label="Revenue tracked"
          value={formatMoney(data.period.revenueCents, currency)}
          note={changeNote(data.period.revenueChangePct)}
          tone={toneOf(data.period.revenueChangePct)}
        />
        <Stat
          label="Visits"
          value={formatNumber(data.period.visits)}
          note={changeNote(data.period.visitsChangePct)}
          tone={toneOf(data.period.visitsChangePct)}
        />
        <Stat
          label="Members"
          value={formatNumber(data.members.total)}
          note={`${formatNumber(data.members.new)} joined · ${formatNumber(data.members.active)} active`}
        />
        <Stat
          label="Points outstanding"
          value={formatNumber(data.members.pointsOutstanding)}
          note={`${formatNumber(data.period.pointsIssued)} issued this period`}
        />
      </div>

      <section className="card stack">
        <div className="row row--between">
          <h2 style={{ margin: 0, fontSize: 15 }}>Revenue per day</h2>
          <span className="pill">{formatNumber(data.period.transactions)} transactions</span>
        </div>
        <LineChart
          points={data.series}
          valueFor={(point) => point.revenue_cents / 100}
          labelFor={(point) =>
            new Date(point.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
          }
          formatValue={(value) => formatMoney(value * 100, currency)}
        />
      </section>

      <div className="grid grid--2">
        <section className="card stack">
          <h2 style={{ margin: 0, fontSize: 15 }}>Your best customers</h2>
          {data.topMembers.length === 0 ? (
            <Empty icon="👋" title="No members yet" body="Sign your first customer up at the counter." />
          ) : (
            <div className="stack stack--sm">
              {data.topMembers.map((member) => (
                <Link
                  key={member.id}
                  to={`/app/members/${member.id}`}
                  className="row"
                  style={{ textDecoration: 'none', color: 'inherit', padding: '4px 0' }}
                >
                  <span className="avatar" aria-hidden="true">{initials(member.name)}</span>
                  <span className="grow">
                    <span className="strong small truncate" style={{ display: 'block' }}>{member.name}</span>
                    <span className="tiny muted">
                      {formatNumber(member.visits)} visits · {formatMoney(member.totalSpendCents, currency)}
                    </span>
                  </span>
                  <span className="small tabular strong">{formatNumber(member.lifetimePoints)} pts</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0, fontSize: 15 }}>Members by tier</h2>
          <div className="stack stack--sm">
            {data.tiers.map((tier) => (
              <div key={tier.id} className="stack stack--sm">
                <div className="row row--between small">
                  <span className="row" style={{ gap: 7 }}>
                    <span
                      style={{ width: 9, height: 9, borderRadius: '50%', background: tier.color }}
                      aria-hidden="true"
                    />
                    {tier.name}
                  </span>
                  <span className="muted tabular">{formatNumber(tier.memberCount)}</span>
                </div>
                <div className="bar">
                  <div
                    className="bar__fill"
                    style={{
                      width: `${Math.round((tier.memberCount / totalTierMembers) * 100)}%`,
                      background: tier.color,
                    }}
                  />
                </div>
              </div>
            ))}
            {data.tiers.length === 0 ? <p className="muted small">No tiers configured.</p> : null}
          </div>
        </section>
      </div>

      <div className="grid grid--2">
        <section className="card stack">
          <h2 style={{ margin: 0, fontSize: 15 }}>Revenue by location</h2>
          {data.byLocation.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>No transactions recorded yet.</p>
          ) : (
            <div className="stack stack--sm">
              {data.byLocation.map((row) => (
                <div key={row.locationId ?? 'none'} className="stack stack--sm">
                  <div className="row row--between small">
                    <span className="truncate">{row.name}</span>
                    <span className="muted tabular">{formatMoney(row.revenueCents, currency)}</span>
                  </div>
                  <div className="bar">
                    <div
                      className="bar__fill"
                      style={{ width: `${Math.round((row.revenueCents / maxLocationRevenue) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0, fontSize: 15 }}>Rewards</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <Stat label="Redeemed this period" value={formatNumber(data.redemptions.total)} />
            <Stat label="Waiting to collect" value={formatNumber(data.redemptions.pending)} />
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>
            {formatNumber(data.redemptions.pointsSpent)} points spent by your members in the last {days} days.
          </p>
          <Link className="btn btn--ghost btn--sm" to="/app/redemptions" style={{ alignSelf: 'flex-start' }}>
            Open redemption queue
          </Link>
        </section>
      </div>
    </div>
  );
}

function changeNote(pct: number | null): string | undefined {
  if (pct === null) return undefined;
  return `${pct >= 0 ? '+' : ''}${pct}% vs previous period`;
}

function toneOf(pct: number | null): 'positive' | 'negative' | undefined {
  if (pct === null) return undefined;
  return pct >= 0 ? 'positive' : 'negative';
}
