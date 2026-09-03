import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { hasStoredSession, onSessionChange, restoreSession } from './lib/api';
import { Auth } from './pages/Auth';
import { Wallet } from './pages/Wallet';
import { Discover } from './pages/Discover';
import { CardDetail } from './pages/CardDetail';
import { Rewards } from './pages/Rewards';
import { Profile } from './pages/Profile';

const TABS = [
  { to: '/', label: 'Wallet', icon: '🎫' },
  { to: '/discover', label: 'Discover', icon: '🧭' },
  { to: '/rewards', label: 'Rewards', icon: '🎁' },
  { to: '/profile', label: 'Profile', icon: '👤' },
] as const;

const TITLES: Record<string, string> = {
  '/': 'Your wallet',
  '/discover': 'Discover',
  '/rewards': 'Your rewards',
  '/profile': 'Profile',
};

export function App() {
  const [status, setStatus] = useState<'checking' | 'signed-in' | 'signed-out'>(
    hasStoredSession() ? 'checking' : 'signed-out',
  );

  useEffect(() => {
    if (status !== 'checking') return;
    restoreSession().then((ok) => setStatus(ok ? 'signed-in' : 'signed-out'));
  }, [status]);

  useEffect(
    () => onSessionChange((signedIn) => setStatus(signedIn ? 'signed-in' : 'signed-out')),
    [],
  );

  if (status === 'checking') {
    return (
      <div className="auth">
        <span className="auth__logo">LoyaltyLoop</span>
        <p className="auth__tagline">Opening your wallet…</p>
      </div>
    );
  }

  if (status === 'signed-out') {
    return <Auth onSignedIn={() => setStatus('signed-in')} />;
  }

  return (
    <BrowserRouter>
      <Shell onSignedOut={() => setStatus('signed-out')} />
    </BrowserRouter>
  );
}

function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const onCardPage = location.pathname.startsWith('/card/');
  const title = onCardPage ? 'Your card' : TITLES[location.pathname] ?? 'LoyaltyLoop';

  return (
    <div className="app">
      <header className="topbar">
        {onCardPage ? (
          <button type="button" className="iconbutton" onClick={() => navigate(-1)} aria-label="Go back">
            ←
          </button>
        ) : null}
        <h1 className="topbar__title">{title}</h1>
      </header>

      <main className="app__main">
        <Routes>
          <Route path="/" element={<Wallet />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/card/:merchantId" element={<CardDetail />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/profile" element={<Profile onSignedOut={onSignedOut} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className="tabbar__item">
            <span className="tabbar__icon" aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
