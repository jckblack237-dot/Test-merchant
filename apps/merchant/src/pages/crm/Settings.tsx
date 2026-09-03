import { useEffect, useState, type FormEvent } from 'react';
import { api, type MerchantProfile } from '../../lib/api';
import { canAct, useSession } from '../../lib/session';
import { ErrorNote, Loading } from '../../components/ui';
import { describeError } from '../site/SignUp';

export function Settings() {
  const { user, refresh } = useSession();
  const [form, setForm] = useState<MerchantProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = canAct(user.role, 'owner');

  useEffect(() => {
    api<{ merchant: MerchantProfile }>('/merchant/account/settings')
      .then((response) => setForm(response.merchant))
      .catch((caught) => setError((caught as Error).message));
  }, []);

  if (error && !form) return <ErrorNote message={error} />;
  if (!form) return <Loading rows={3} />;

  const set = <K extends keyof MerchantProfile>(key: K, value: MerchantProfile[K]) => {
    setForm({ ...form, [key]: value });
    setSaved(false);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('/merchant/account/settings', {
        method: 'PATCH',
        body: {
          name: form.name,
          slug: form.slug,
          tagline: form.tagline,
          description: form.description,
          brandColor: form.brandColor,
          currency: form.currency,
          pointsPerCurrency: Number(form.pointsPerCurrency),
          signupBonusPoints: Number(form.signupBonusPoints),
          isListed: form.isListed,
        },
      });
      setSaved(true);
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack--lg" onSubmit={save} style={{ maxWidth: 760 }}>
      {!canEdit ? (
        <div className="alert alert--warning">
          Only an owner can change these settings. You can look, but the fields are read-only.
        </div>
      ) : null}

      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: 16 }}>Your brand</h2>
        <p className="muted small" style={{ margin: 0 }}>
          This is what customers see in the LoyaltyLoop app.
        </p>

        <label className="field">
          <span className="field__label">Business name</span>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} disabled={!canEdit} required />
        </label>

        <label className="field">
          <span className="field__label">Web address</span>
          <input
            className="input"
            value={form.slug}
            onChange={(e) => set('slug', e.target.value)}
            disabled={!canEdit}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
          <span className="field__hint">loyaltyloop.app/{form.slug}</span>
        </label>

        <label className="field">
          <span className="field__label">Tagline</span>
          <input
            className="input"
            value={form.tagline}
            onChange={(e) => set('tagline', e.target.value)}
            disabled={!canEdit}
            placeholder="Specialty coffee, every corner."
          />
        </label>

        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            className="textarea"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            disabled={!canEdit}
          />
        </label>

        <div className="row row--wrap">
          <label className="field">
            <span className="field__label">Brand colour</span>
            <input
              className="input"
              type="color"
              value={form.brandColor}
              onChange={(e) => set('brandColor', e.target.value)}
              disabled={!canEdit}
              style={{ width: 76, padding: 4, height: 38 }}
            />
          </label>
          <label className="field" style={{ width: 110 }}>
            <span className="field__label">Currency</span>
            <input
              className="input"
              value={form.currency}
              onChange={(e) => set('currency', e.target.value.toUpperCase())}
              disabled={!canEdit}
              maxLength={3}
            />
          </label>
        </div>

        <label className="row" style={{ gap: 9 }}>
          <input
            type="checkbox"
            checked={form.isListed}
            onChange={(e) => set('isListed', e.target.checked)}
            disabled={!canEdit}
            style={{ width: 17, height: 17 }}
          />
          <span className="small">
            List us in the customer app's Discover directory
            <span className="tiny muted" style={{ display: 'block' }}>
              Turn this off to run a private programme that only your existing customers can join.
            </span>
          </span>
        </label>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: 16 }}>How points are earned</h2>

        <label className="field">
          <span className="field__label">Points per {form.currency} spent</span>
          <input
            className="input"
            type="number"
            step="0.1"
            min="0"
            value={form.pointsPerCurrency}
            onChange={(e) => set('pointsPerCurrency', Number(e.target.value) as never)}
            disabled={!canEdit}
            style={{ maxWidth: 160 }}
          />
          <span className="field__hint">
            At {form.pointsPerCurrency} points per {form.currency}, a {form.currency} 10 order earns{' '}
            {Math.floor(10 * Number(form.pointsPerCurrency))} points before tier and campaign bonuses.
          </span>
        </label>

        <label className="field">
          <span className="field__label">Welcome bonus</span>
          <input
            className="input"
            type="number"
            min="0"
            value={form.signupBonusPoints}
            onChange={(e) => set('signupBonusPoints', Number(e.target.value) as never)}
            disabled={!canEdit}
            style={{ maxWidth: 160 }}
          />
          <span className="field__hint">Points given the moment someone joins your programme.</span>
        </label>
      </section>

      <section className="card stack stack--sm">
        <h2 style={{ margin: 0, fontSize: 16 }}>Your data</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Your members, sales and notes belong to you alone. No other business on LoyaltyLoop can
          read any of it — every query we run is locked to your account. You can export your full
          member list as CSV at any time from the Members screen, including after you cancel.
        </p>
      </section>

      {error ? <ErrorNote message={error} /> : null}
      {saved ? <p className="alert alert--success">Settings saved.</p> : null}

      {canEdit ? (
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      ) : null}
    </form>
  );
}
