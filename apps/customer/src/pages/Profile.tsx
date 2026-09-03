import { useEffect, useState, type FormEvent } from 'react';
import { api, signOut, type Customer } from '../lib/api';
import { ErrorNote, Spinner } from '../components/ui';

export function Profile({ onSignedOut }: { onSignedOut: () => void }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ customer: Customer }>('/auth/customer/me')
      .then((response) => {
        setCustomer(response.customer);
        setName(response.customer.name);
        setPhone(response.customer.phone ?? '');
      })
      .catch((caught) => setError((caught as Error).message));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await api<{ customer: Customer }>('/customer/profile', {
        method: 'PATCH',
        body: { name, phone: phone || null },
      });
      setCustomer(response.customer);
      setSaved(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!customer && !error) return <Spinner />;

  return (
    <div className="stack stack--lg">
      {error ? <ErrorNote message={error} /> : null}

      <form className="card stack" onSubmit={save}>
        <label className="field">
          <span className="field__label">Name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">Email</span>
          <input className="input" value={customer?.email ?? ''} readOnly disabled />
        </label>
        <label className="field">
          <span className="field__label">Phone (optional)</span>
          <input
            className="input"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
          />
        </label>
        {saved ? <p className="alert alert--success">Saved.</p> : null}
        <button className="btn btn--block" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <div className="card stack stack--sm">
        <span className="strong">Your data</span>
        <p className="small muted" style={{ margin: 0 }}>
          Each shop you join sees only your membership with them — your name, contact details and the
          points you have earned there. They never see where else you shop or what you spend elsewhere.
        </p>
      </div>

      <button
        type="button"
        className="btn btn--danger btn--block"
        onClick={async () => {
          await signOut();
          onSignedOut();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
