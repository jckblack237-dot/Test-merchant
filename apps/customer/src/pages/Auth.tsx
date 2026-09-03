import { useState, type FormEvent } from 'react';
import { ApiError, signIn, signUp } from '../lib/api';
import { ErrorNote } from '../components/ui';

/** Combined sign-in / sign-up screen. */
export function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await signIn(email, password);
      else await signUp({ name, email, password });
      onSignedIn();
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.details && Array.isArray(caught.details)
            ? (caught.details as { message: string }[])[0]?.message ?? caught.message
            : caught.message
          : 'Could not reach the server. Check your connection.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="stack stack--sm">
        <span className="auth__logo">LoyaltyLoop</span>
        <p className="auth__tagline" style={{ margin: 0 }}>
          Every loyalty card you own, in one place. Collect points at your favourite cafés and swap
          them for the good stuff.
        </p>
      </div>

      <form className="stack" onSubmit={submit}>
        {mode === 'signup' ? (
          <label className="field">
            <span className="field__label">Your name</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>
        ) : null}

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
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
          />
          {mode === 'signup' ? (
            <span className="tiny muted">At least 10 characters, including a number.</span>
          ) : null}
        </label>

        {error ? <ErrorNote message={error} /> : null}

        <button className="btn btn--block" type="submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className="small center muted" style={{ margin: 0 }}>
        {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
        <button
          type="button"
          className="btn btn--sm btn--subtle"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
        >
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
