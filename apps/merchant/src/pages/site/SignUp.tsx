import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api, signUp, type PlanOption, type SessionPayload } from '../../lib/api';
import { ErrorNote, formatMoney } from '../../components/ui';

export function SignUp({ onSignedIn }: { onSignedIn: (session: SessionPayload) => void }) {
  const [searchParams] = useSearchParams();
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planCode, setPlanCode] = useState(searchParams.get('plan') ?? 'growth');
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ plans: PlanOption[] }>('/plans')
      .then((response) => setPlans(response.plans))
      .catch(() => setPlans([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await signUp({ businessName, ownerName, email, password, planCode });
      onSignedIn(session);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--wide stack stack--lg">
        <Link className="site__logo" to="/" style={{ justifyContent: 'center' }}>
          <span className="crm__mark" aria-hidden="true">L</span>
          LoyaltyLoop
        </Link>

        <div className="card stack">
          <div>
            <h1 style={{ margin: 0, fontSize: 21 }}>Start your free trial</h1>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              14 days, no card. Your programme is live the moment you finish this form.
            </p>
          </div>

          <form className="stack" onSubmit={submit}>
            <label className="field">
              <span className="field__label">Business name</span>
              <input
                className="input"
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder="Zuz Coffee"
                required
              />
              <span className="field__hint">This is the name customers see in the app.</span>
            </label>

            <label className="field">
              <span className="field__label">Your name</span>
              <input
                className="input"
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>

            <label className="field">
              <span className="field__label">Work email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label className="field">
              <span className="field__label">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
              <span className="field__hint">At least 10 characters, including a number.</span>
            </label>

            <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="field__label" style={{ padding: 0 }}>Plan</legend>
              <div className="stack stack--sm" style={{ marginTop: 4 }}>
                {plans.map((plan) => (
                  <label
                    key={plan.code}
                    className="row"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${planCode === plan.code ? 'var(--brand)' : 'var(--border-strong)'}`,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={plan.code}
                      checked={planCode === plan.code}
                      onChange={() => setPlanCode(plan.code)}
                    />
                    <span className="grow">
                      <span className="strong small">{plan.name}</span>
                      <span className="tiny muted" style={{ display: 'block' }}>
                        {plan.limits.locations < 0 ? 'Unlimited' : plan.limits.locations} locations ·{' '}
                        {plan.limits.members < 0 ? 'Unlimited' : plan.limits.members.toLocaleString()} members
                      </span>
                    </span>
                    <span className="strong small tabular">
                      {formatMoney(plan.priceCents, plan.currency)}/{plan.interval}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error ? <ErrorNote message={error} /> : null}

            <button className="btn btn--block btn--lg" type="submit" disabled={busy}>
              {busy ? 'Creating your account…' : 'Create account and start trial'}
            </button>
          </form>
        </div>

        <p className="small muted center" style={{ margin: 0 }}>
          Already have an account? <Link to="/signin">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (Array.isArray(caught.details) && caught.details.length > 0) {
      const first = caught.details[0] as { field?: string; message?: string };
      return first.message ? `${first.field ? `${first.field}: ` : ''}${first.message}` : caught.message;
    }
    return caught.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}
