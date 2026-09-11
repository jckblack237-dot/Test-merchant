import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  fetchMe,
  hasStoredSession,
  onSessionChange,
  restoreSession,
  signOut as apiSignOut,
  type MerchantProfile,
  type MerchantUser,
  type SessionPayload,
} from './lib/api';
import { SessionContext, type SessionValue } from './lib/session';
import { SignIn } from './pages/SignIn';
import { MissionControl } from './pages/MissionControl';
import { MissionDetail } from './pages/MissionDetail';
import { History } from './pages/History';
import { Agents } from './pages/Agents';

interface Identity {
  user: MerchantUser;
  merchant: MerchantProfile;
}

export function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState<'checking' | 'ready'>(hasStoredSession() ? 'checking' : 'ready');

  const load = useCallback(async () => {
    try {
      const me = await fetchMe();
      setIdentity({ user: me.user, merchant: me.merchant });
    } catch {
      setIdentity(null);
    }
  }, []);

  useEffect(() => {
    if (status !== 'checking') return;
    (async () => {
      if (await restoreSession()) await load();
      setStatus('ready');
    })();
  }, [status, load]);

  useEffect(
    () =>
      onSessionChange((signedIn) => {
        if (!signedIn) setIdentity(null);
      }),
    [],
  );

  if (status === 'checking') {
    return (
      <div className="auth-page">
        <div className="stack stack--sm center">
          <span className="app__mark" style={{ width: 44, height: 44, fontSize: 22 }} aria-hidden="true">
            🏝️
          </span>
          <span className="muted small">Sailing you back to the island…</span>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Router identity={identity} setIdentity={setIdentity} reload={load} />
    </BrowserRouter>
  );
}

function Router({
  identity,
  setIdentity,
  reload,
}: {
  identity: Identity | null;
  setIdentity: (value: Identity | null) => void;
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();

  const session = useMemo<SessionValue | null>(
    () =>
      identity
        ? {
            ...identity,
            refresh: reload,
            signOut: async () => {
              await apiSignOut();
              setIdentity(null);
              navigate('/');
            },
          }
        : null,
    [identity, reload, setIdentity, navigate],
  );

  if (!session) {
    return (
      <SignIn
        onSignedIn={(payload: SessionPayload) =>
          setIdentity({ user: payload.user, merchant: payload.merchant })
        }
      />
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <div className="app">
        <header className="app__nav">
          <Link className="app__brand" to="/">
            <span className="app__mark" aria-hidden="true">🏝️</span>
            AI Agent Island
          </Link>

          <nav className="app__links">
            <NavLink className="app__link" to="/" end>
              Mission control
            </NavLink>
            <NavLink className="app__link" to="/missions">
              Missions
            </NavLink>
            <NavLink className="app__link" to="/agents">
              Agents
            </NavLink>
          </nav>

          <span className="app__spacer" />

          <span className="app__user">
            <span className="truncate">{session.merchant.name}</span>
            <span>·</span>
            <span className="truncate">
              {session.user.name} ({session.user.role})
            </span>
          </span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => session.signOut()}>
            Sign out
          </button>
        </header>

        <main className="app__main">
          <Routes>
            <Route path="/" element={<MissionControl />} />
            <Route path="/missions" element={<History />} />
            <Route path="/missions/:id" element={<MissionDetail />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <footer className="app__footer">
          Every agent run, every source and every correction is stored as it happens. Nothing in a
          report is written after the fact.
        </footer>
      </div>
    </SessionContext.Provider>
  );
}
