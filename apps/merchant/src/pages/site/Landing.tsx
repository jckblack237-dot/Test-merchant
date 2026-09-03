import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PlanOption } from '../../lib/api';
import { formatMoney } from '../../components/ui';

const FEATURES = [
  {
    icon: '🎫',
    title: 'A loyalty programme in an afternoon',
    body: 'Points per dollar, tier ladders, reward catalogue. Your customers see it in the LoyaltyLoop app the moment you switch it on.',
  },
  {
    icon: '👥',
    title: 'A CRM that knows your regulars',
    body: 'Every member, their visits, spend, tier and full points history — searchable, taggable, with private notes only your team can see.',
  },
  {
    icon: '🔒',
    title: 'Your data is only ever yours',
    body: 'Every record is locked to your account at the database layer. No other merchant on the platform can read a single row of it.',
  },
  {
    icon: '⚡',
    title: 'Fast at the counter',
    body: 'Scan a customer’s code, type the amount, done. Or wire your till straight into the API and let it award points itself.',
  },
  {
    icon: '📈',
    title: 'See what retention is worth',
    body: 'Revenue and visits per location, active members, points outstanding, and which rewards actually bring people back.',
  },
  {
    icon: '🎯',
    title: 'Campaigns that shift a quiet Tuesday',
    body: 'Double points days, bonus point promotions, per-location offers. Set the window and the rules apply themselves.',
  },
];

export function Landing() {
  const [plans, setPlans] = useState<PlanOption[]>([]);

  useEffect(() => {
    api<{ plans: PlanOption[] }>('/plans')
      .then((response) => setPlans(response.plans))
      .catch(() => setPlans([]));
  }, []);

  return (
    <>
      <section className="site__section" style={{ paddingTop: 56 }}>
        <div className="site__inner hero">
          <div className="stack stack--lg">
            <span className="eyebrow">Customer retention for cafés and chains</span>
            <h1 className="hero__title">
              Turn a good coffee into a regular customer.
            </h1>
            <p className="hero__lede" style={{ margin: 0 }}>
              LoyaltyLoop gives your shop a points programme your customers actually carry in their
              pocket, and gives you the CRM to see who they are, what they buy and when they stop
              coming in.
            </p>
            <div className="row row--wrap">
              <Link className="btn btn--lg" to="/signup">
                Start your free trial
              </Link>
              <a className="btn btn--lg btn--ghost" href="#pricing">
                See pricing
              </a>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              14 days free · no card required · cancel any time
            </p>
          </div>

          <HeroMock />
        </div>
      </section>

      <section className="site__section" style={{ background: 'var(--surface)', borderBlock: '1px solid var(--border)' }}>
        <div className="site__inner center">
          <h2 className="site__title">Everything you need to keep people coming back</h2>
          <p className="site__sub">
            One subscription covers the customer app, your CRM, and the loyalty engine behind both.
          </p>
          <div className="grid grid--3" style={{ textAlign: 'left' }}>
            {FEATURES.map((feature) => (
              <article key={feature.title} className="feature">
                <span className="feature__icon" aria-hidden="true">{feature.icon}</span>
                <span className="feature__title">{feature.title}</span>
                <p className="small muted" style={{ margin: 0 }}>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="site__section" id="security">
        <div className="site__inner">
          <div className="grid grid--2" style={{ alignItems: 'center', gap: 40 }}>
            <div className="stack">
              <span className="eyebrow">Built for shared infrastructure</span>
              <h2 className="site__title" style={{ marginBottom: 0 }}>
                Your customer list never touches another merchant's screen.
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                LoyaltyLoop runs every merchant on one platform, so isolation is not a policy — it is
                the architecture. Your account id is taken from your signed-in session and stamped
                onto every single database query. Code that forgets to filter by merchant does not
                compile past our data layer; it is not a check we can forget to write.
              </p>
              <ul className="stack stack--sm small" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Ids are random, so nothing can be guessed or enumerated.</li>
                <li>A request for another merchant's record returns "not found" — we never confirm it exists.</li>
                <li>Staff roles limit what your own team can see and do.</li>
                <li>Every change is written to an audit log only you can read.</li>
                <li>Till API keys are stored hashed and can award points but nothing else.</li>
              </ul>
            </div>

            <div className="card stack" style={{ background: 'var(--surface-2)' }}>
              <span className="tiny muted strong">HOW A REQUEST IS SCOPED</span>
              <pre
                className="mono tiny"
                style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--text-muted)' }}
              >
{`GET /api/merchant/members/mem_8f2…

  1. verify signed token   → merchant: you
  2. build tenant store    → locked to you
  3. SELECT … WHERE id = ?
       AND merchant_id = ?   ← always added
  4. no row for you        → 404 not found`}
              </pre>
              <p className="tiny muted" style={{ margin: 0 }}>
                Step 3 is not written by hand on each endpoint. It is added by the data layer, every
                time, and a boot-time check refuses to start the server if any merchant-owned table
                is ever added outside it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="site__section" id="pricing" style={{ background: 'var(--surface)', borderBlock: '1px solid var(--border)' }}>
        <div className="site__inner center">
          <h2 className="site__title">Simple monthly pricing</h2>
          <p className="site__sub">
            Every plan includes the customer app, the CRM and unlimited points. Start on a 14-day
            trial and change plan whenever you like.
          </p>

          <div className="grid grid--3" style={{ textAlign: 'left' }}>
            {plans.map((plan, index) => (
              <article
                key={plan.code}
                className={`price-card ${index === 1 ? 'price-card--featured' : ''}`}
              >
                {index === 1 ? (
                  <span className="pill pill--brand" style={{ alignSelf: 'flex-start' }}>Most popular</span>
                ) : null}
                <div>
                  <div className="strong" style={{ fontSize: 16 }}>{plan.name}</div>
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
                <Link
                  className={`btn btn--block ${index === 1 ? '' : 'btn--ghost'}`}
                  to={`/signup?plan=${plan.code}`}
                >
                  Start free trial
                </Link>
              </article>
            ))}
            {plans.length === 0
              ? [0, 1, 2].map((index) => <div key={index} className="skeleton" style={{ height: 380 }} />)
              : null}
          </div>
        </div>
      </section>

      <section className="site__section">
        <div className="site__inner center stack">
          <h2 className="site__title" style={{ marginBottom: 0 }}>Ready to know your regulars?</h2>
          <p className="site__sub" style={{ marginBottom: 8 }}>
            Set your programme up today and start collecting on your next order.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn btn--lg" to="/signup">Create your account</Link>
            <Link className="btn btn--lg btn--ghost" to="/signin">Sign in</Link>
          </div>
        </div>
      </section>
    </>
  );
}

/** A still of the CRM dashboard, drawn in CSS so it stays sharp and weighs nothing. */
function HeroMock() {
  const bars = [46, 62, 38, 74, 88, 57, 96];
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock__bar">
        <span className="mock__dot" />
        <span className="mock__dot" />
        <span className="mock__dot" />
      </div>
      <div className="mock__body stack">
        <div className="row row--between">
          <span className="strong">This month</span>
          <span className="pill pill--positive">+18.4%</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            ['Members', '1,284'],
            ['Visits', '3,907'],
            ['Points out', '48,210'],
          ].map(([label, value]) => (
            <div key={label} className="stat">
              <span className="stat__label">{label}</span>
              <span className="stat__value" style={{ fontSize: 19 }}>{value}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ alignItems: 'flex-end', gap: 7, height: 96 }}>
          {bars.map((height, index) => (
            <div
              key={index}
              style={{
                flex: 1,
                height: `${height}%`,
                borderRadius: 5,
                background: index === bars.length - 1 ? 'var(--brand)' : 'var(--brand-soft)',
              }}
            />
          ))}
        </div>
        <div className="stack stack--sm">
          {[
            { name: 'Aisha R.', tier: 'Gold', points: '1,240 pts' },
            { name: 'Ben C.', tier: 'Silver', points: '860 pts' },
            { name: 'Chen W.', tier: 'Silver', points: '705 pts' },
          ].map(({ name, tier, points }) => (
            <div key={name} className="row row--between small">
              <span className="row" style={{ gap: 8 }}>
                <span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                  {name.slice(0, 1)}
                </span>
                {name}
              </span>
              <span className="row" style={{ gap: 8 }}>
                <span className="pill">{tier}</span>
                <span className="tabular muted">{points}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
