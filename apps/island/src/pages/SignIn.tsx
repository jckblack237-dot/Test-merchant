import { useState, type FormEvent } from 'react';
import { describeError, signIn, type SessionPayload } from '../lib/api';
import { ErrorNote } from '../components/ui';

/** The island is a feature of the merchant account, so this is the CRM sign-in. */
export function SignIn({ onSignedIn }: { onSignedIn: (session: SessionPayload) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signIn(email, password));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card stack stack--lg">
        <div className="stack stack--sm center">
          <span
            className="app__mark"
            style={{ width: 48, height: 48, fontSize: 24, margin: '0 auto' }}
            aria-hidden="true"
          >
            🏝️
          </span>
          <h1 style={{ margin: 0, fontSize: 22 }}>AI Agent Island</h1>
          <p className="small muted" style={{ margin: 0 }}>
            Give one task to an island of specialist agents. They research it, challenge each other,
            verify the claims, cost it out and hand back a report you can audit.
          </p>
        </div>

        <form className="card stack" onSubmit={submit}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Sign in</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Use the same login as your LoyaltyLoop CRM.
            </p>
          </div>

          <label className="field">
            <span className="field__label">Email</span>
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
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <ErrorNote message={error} /> : null}

          <button className="btn btn--block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
