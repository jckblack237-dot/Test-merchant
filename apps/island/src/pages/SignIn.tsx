import { useState, type FormEvent } from 'react';
import { describeError, signIn, type SessionPayload } from '../lib/api';
import { ErrorNote, IslandMark } from '../components/ui';

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
          <span className="app__mark app__mark--lg" aria-hidden="true">
            <IslandMark size={22} />
          </span>
          <span className="strong">AI Agent Island</span>
          <span className="small muted">
            Give one task to an island of specialist agents. They research it, challenge each other,
            verify the claims, cost it out and hand back a report you can audit.
          </span>
        </div>

        <form className="card stack" onSubmit={submit}>
          <div className="stack stack--sm">
            <h1 className="report__heading">Sign in</h1>
            <span className="small muted">Use the same login as your LoyaltyLoop CRM.</span>
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
