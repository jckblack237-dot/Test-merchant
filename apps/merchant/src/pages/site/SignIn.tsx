import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { signIn, type SessionPayload } from '../../lib/api';
import { ErrorNote } from '../../components/ui';
import { describeError } from './SignUp';

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
        <Link className="site__logo" to="/" style={{ justifyContent: 'center' }}>
          <span className="crm__mark" aria-hidden="true">L</span>
          LoyaltyLoop
        </Link>

        <form className="card stack" onSubmit={submit}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>Sign in to your CRM</h1>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Owners, managers and counter staff all sign in here.
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

        <p className="small muted center" style={{ margin: 0 }}>
          No account yet? <Link to="/signup">Start a free trial</Link>
        </p>
      </div>
    </div>
  );
}
