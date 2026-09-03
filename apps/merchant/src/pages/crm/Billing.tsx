import { useCallback, useEffect, useState } from 'react';
import { api, type PlanOption } from '../../lib/api';
import { useSession } from '../../lib/session';
import { ErrorNote, Loading, formatMoney, formatNumber } from '../../components/ui';
import { describeError } from '../site/SignUp';

interface BillingResponse {
  subscription: {
    planCode: string; planName: string; priceCents: number; currency: string; interval: string;
    status: string; writable: boolean; trialDaysLeft: number | null; renewsAt: string | null;
    reason: string | null;
    limits: { locations: number; staff: number; members: number };
  };
  usage: { locations: number; staff: number; members: number };
  availablePlans: PlanOption[];
}

export function Billing() {
  const { refresh } = useSession();
  const [data, setData] = useState<BillingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api<BillingResponse>('/merchant/account/billing'));
  }, []);

  useEffect(() => {
    load().catch((caught) => setError((caught as Error).message));
  }, [load]);

  async function changePlan(planCode: string) {
    setBusy(planCode);
    setError(null);
    try {
      await api('/merchant/account/billing/plan', { method: 'POST', body: { planCode } });
      await load();
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!confirm('Cancel your subscription? You keep read access to your data, but points can no longer be awarded.')) {
      return;
    }
    setBusy('cancel');
    try {
      await api('/merchant/account/billing/cancel', { method: 'POST' });
      await load();
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return <Loading rows={3} />;

  const { subscription, usage } = data;

  return (
    <div className="stack stack--lg">
      {error ? <ErrorNote message={error} /> : null}

      {!subscription.writable && subscription.reason ? (
        <div className="alert alert--warning">{subscription.reason}</div>
      ) : null}

      <section className="card stack">
        <div className="row row--between row--wrap">
          <div>
            <span className="field__label">Current plan</span>
            <div className="row" style={{ gap: 9 }}>
              <h2 style={{ margin: 0, fontSize: 21 }}>{subscription.planName}</h2>
              <StatusPill status={subscription.status} />
            </div>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {formatMoney(subscription.priceCents, subscription.currency)} per {subscription.interval}
              {subscription.trialDaysLeft !== null && subscription.status === 'trialing'
                ? ` · ${subscription.trialDaysLeft} days left in your trial`
                : subscription.renewsAt
                  ? ` · renews ${new Date(subscription.renewsAt).toLocaleDateString()}`
                  : ''}
            </p>
          </div>
          {subscription.status !== 'cancelled' ? (
            <button type="button" className="btn btn--danger btn--sm" onClick={cancel} disabled={busy === 'cancel'}>
              Cancel subscription
            </button>
          ) : null}
        </div>

        <div className="grid grid--3">
          <UsageMeter label="Locations" used={usage.locations} limit={subscription.limits.locations} />
          <UsageMeter label="Staff accounts" used={usage.staff} limit={subscription.limits.staff} />
          <UsageMeter label="Loyalty members" used={usage.members} limit={subscription.limits.members} />
        </div>
      </section>

      <section className="stack">
        <h2 style={{ margin: 0, fontSize: 16 }}>Change plan</h2>
        <div className="grid grid--3">
          {data.availablePlans.map((plan) => {
            const current = plan.code === subscription.planCode && subscription.status !== 'cancelled';
            return (
              <article key={plan.code} className={`price-card ${current ? 'price-card--featured' : ''}`}>
                <div>
                  <div className="row row--between">
                    <span className="strong" style={{ fontSize: 16 }}>{plan.name}</span>
                    {current ? <span className="pill pill--brand">Current</span> : null}
                  </div>
                  <p className="small muted" style={{ margin: '4px 0 0' }}>{plan.description}</p>
                </div>
                <div>
                  <span className="price-card__amount">{formatMoney(plan.priceCents, plan.currency)}</span>
                  <span className="muted small"> /{plan.interval}</span>
                </div>
                <ul className="price-card__list">
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <span className="price-card__tick" aria-hidden="true">✓</span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`btn btn--block ${current ? 'btn--ghost' : ''}`}
                  disabled={current || busy === plan.code}
                  onClick={() => changePlan(plan.code)}
                >
                  {current ? 'Your plan' : busy === plan.code ? 'Switching…' : `Switch to ${plan.name}`}
                </button>
              </article>
            );
          })}
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          Downgrades are blocked while you are over the smaller plan's limits — remove the extra
          locations or staff first, so nothing of yours is ever quietly switched off.
        </p>
      </section>
    </div>
  );
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const tone = pct >= 100 ? 'var(--negative)' : pct >= 80 ? 'var(--warning)' : 'var(--brand)';

  return (
    <div className="stack stack--sm">
      <div className="row row--between small">
        <span className="muted">{label}</span>
        <span className="tabular strong">
          {formatNumber(used)}
          {unlimited ? '' : ` / ${formatNumber(limit)}`}
        </span>
      </div>
      <div className="bar">
        <div className="bar__fill" style={{ width: `${unlimited ? 6 : pct}%`, background: tone }} />
      </div>
      {unlimited ? <span className="tiny muted">Unlimited on this plan</span> : null}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    active: ['pill--positive', 'Active'],
    trialing: ['pill--info', 'Free trial'],
    past_due: ['pill--warning', 'Payment needed'],
    cancelled: ['pill--negative', 'Cancelled'],
  };
  const [tone, label] = map[status] ?? ['pill', status];
  return <span className={`pill ${tone}`}>{label}</span>;
}
