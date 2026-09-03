import { useCallback, useEffect, useState } from 'react';
import { api, type MerchantUser } from '../../lib/api';
import { canAct, useSession } from '../../lib/session';
import { ErrorNote, Loading, Modal, formatRelative, initials } from '../../components/ui';
import { describeError } from '../site/SignUp';

interface TeamMember extends MerchantUser {
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const ROLE_HELP: Record<string, string> = {
  owner: 'Full access, including team, billing and programme settings.',
  manager: 'Runs the day to day: members, catalogue, adjustments and the audit log.',
  staff: 'Counter only: look customers up, award points, hand over rewards.',
};

export function Team() {
  const { user, subscription } = useSession();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState<{ secret: string; name: string } | null>(null);
  const isOwner = canAct(user.role, 'owner');

  const load = useCallback(async () => {
    const response = await api<{ team: TeamMember[] }>('/merchant/team');
    setTeam(response.team);
    if (isOwner) {
      const keyResponse = await api<{ keys: ApiKey[] }>('/merchant/api-keys');
      setKeys(keyResponse.keys);
    }
  }, [isOwner]);

  useEffect(() => {
    load().catch((caught) => setError((caught as Error).message));
  }, [load]);

  async function updateMember(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/merchant/team/${id}`, { method: 'PATCH', body });
      await load();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  async function removeMember(member: TeamMember) {
    if (!confirm(`Remove ${member.name}? They will be signed out immediately.`)) return;
    setError(null);
    try {
      await api(`/merchant/team/${member.id}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  async function createKey(name: string) {
    const response = await api<{ secret: string; key: { name: string } }>('/merchant/api-keys', {
      method: 'POST',
      body: { name },
    });
    setNewKey({ secret: response.secret, name: response.key.name });
    await load();
  }

  async function revokeKey(id: string) {
    if (!confirm('Revoke this key? Any till using it will stop working immediately.')) return;
    await api(`/merchant/api-keys/${id}/revoke`, { method: 'POST' });
    await load();
  }

  if (!team) return <Loading rows={3} />;

  return (
    <div className="stack stack--lg">
      {error ? <ErrorNote message={error} /> : null}

      <section className="stack">
        <div className="row row--between row--wrap">
          <p className="muted small" style={{ margin: 0 }}>
            Who can sign in to your CRM, and what each of them can do.
          </p>
          {isOwner ? (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setAdding(true)}
              disabled={!subscription.writable}
            >
              Add team member
            </button>
          ) : null}
        </div>

        <div className="card card--flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Last signed in</th>
                  <th>Status</th>
                  {isOwner ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {team.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="row">
                        <span className="avatar" aria-hidden="true">{initials(member.name)}</span>
                        <div>
                          <div className="strong">
                            {member.name}
                            {member.id === user.id ? <span className="pill" style={{ marginLeft: 6 }}>You</span> : null}
                          </div>
                          <div className="tiny muted">{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {isOwner && member.id !== user.id ? (
                        <select
                          className="select"
                          style={{ width: 'auto' }}
                          value={member.role}
                          onChange={(event) => updateMember(member.id, { role: event.target.value })}
                        >
                          <option value="owner">Owner</option>
                          <option value="manager">Manager</option>
                          <option value="staff">Staff</option>
                        </select>
                      ) : (
                        <span className="pill">{member.role}</span>
                      )}
                      <div className="tiny muted" style={{ marginTop: 4, maxWidth: 260 }}>
                        {ROLE_HELP[member.role]}
                      </div>
                    </td>
                    <td className="small muted">{formatRelative(member.lastLoginAt)}</td>
                    <td>
                      {member.status === 'active' ? (
                        <span className="pill pill--positive">Active</span>
                      ) : (
                        <span className="pill pill--negative">Disabled</span>
                      )}
                    </td>
                    {isOwner ? (
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        {member.id === user.id ? null : (
                          <>
                            <button
                              type="button"
                              className="btn btn--sm btn--subtle"
                              onClick={() =>
                                updateMember(member.id, {
                                  status: member.status === 'active' ? 'disabled' : 'active',
                                })
                              }
                            >
                              {member.status === 'active' ? 'Disable' : 'Enable'}
                            </button>{' '}
                            <button type="button" className="btn btn--sm btn--danger" onClick={() => removeMember(member)}>
                              Remove
                            </button>
                          </>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {isOwner ? (
        <section className="stack">
          <div className="row row--between row--wrap">
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>Till & POS keys</h2>
              <p className="muted small" style={{ margin: '2px 0 0' }}>
                Let your point-of-sale award points automatically. A key can award points and look
                members up — nothing else.
              </p>
            </div>
            <ApiKeyButton onCreate={createKey} disabled={!subscription.writable} />
          </div>

          {newKey ? (
            <div className="alert alert--success stack stack--sm">
              <span className="strong">Key created: {newKey.name}</span>
              <code className="mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>{newKey.secret}</code>
              <span className="tiny">
                Copy it now — for your security we only store a hash, so it can never be shown again.
              </span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setNewKey(null)}>
                I've saved it
              </button>
            </div>
          ) : null}

          <div className="card card--flush">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Last used</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(keys ?? []).map((key) => (
                    <tr key={key.id}>
                      <td className="strong">{key.name}</td>
                      <td className="mono small muted">{key.prefix}…</td>
                      <td className="small muted">{formatRelative(key.lastUsedAt)}</td>
                      <td>
                        {key.revokedAt ? (
                          <span className="pill pill--negative">Revoked</span>
                        ) : (
                          <span className="pill pill--positive">Active</span>
                        )}
                      </td>
                      <td className="right">
                        {key.revokedAt ? null : (
                          <button type="button" className="btn btn--sm btn--danger" onClick={() => revokeKey(key.id)}>
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(keys ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="center muted small" style={{ padding: 26 }}>
                        No keys yet. Create one when you're ready to connect your till.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {adding ? (
        <AddTeamMember
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function ApiKeyButton({ onCreate, disabled }: { onCreate: (name: string) => Promise<void>; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen(true)} disabled={disabled}>
        Create key
      </button>
      {open ? (
        <Modal title="Create a till key" onClose={() => setOpen(false)}>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await onCreate(name);
                setOpen(false);
                setName('');
              } catch (caught) {
                setError(describeError(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span className="field__label">What is this key for?</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Front counter till"
                required
              />
            </label>
            {error ? <ErrorNote message={error} /> : null}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function AddTeamMember({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Add a team member" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api('/merchant/team', { method: 'POST', body: { name, email, password, role } });
            onSaved();
          } catch (caught) {
            setError(describeError(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span className="field__label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">Temporary password</span>
          <input
            className="input"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <span className="field__hint">
            At least 10 characters including a number. Ask them to change it after their first sign-in.
          </span>
        </label>
        <label className="field">
          <span className="field__label">Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="staff">Staff</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
          <span className="field__hint">{ROLE_HELP[role]}</span>
        </label>

        {error ? <ErrorNote message={error} /> : null}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Adding…' : 'Add member'}</button>
        </div>
      </form>
    </Modal>
  );
}
