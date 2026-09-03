import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate,
} from 'react-router-dom';
import {
  fetchMe, hasStoredSession, onSessionChange, restoreSession, signOut as apiSignOut,
  type MerchantProfile, type MerchantUser, type SessionPayload, type Subscription,
} from './lib/api';
import { SessionContext, canAct, type SessionValue } from './lib/session';
import { Landing } from './pages/site/Landing';
import { SignIn } from './pages/site/SignIn';
import { SignUp } from './pages/site/SignUp';
import { Dashboard } from './pages/crm/Dashboard';
import { Members } from './pages/crm/Members';
import { MemberDetail } from './pages/crm/MemberDetail';
import { Counter } from './pages/crm/Counter';
import { Redemptions } from './pages/crm/Redemptions';
import { Activity } from './pages/crm/Activity';
import { Campaigns, Locations, Products, Rewards, Tiers } from './pages/crm/Catalog';
import { Team } from './pages/crm/Team';
import { Billing } from './pages/crm/Billing';
import { Settings } from './pages/crm/Settings';
import { AuditLog } from './pages/crm/AuditLog';

interface Identity {
  user: MerchantUser;
  merchant: MerchantProfile;
  subscription: Subscription;
}

export function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState<'checking' | 'ready'>(hasStoredSession() ? 'checking' : 'ready');

  const load = useCallback(async () => {
    try {
      setIdentity(await fetchMe());
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
        <div className="stack center">
          <span className="site__logo" style={{ justifyContent: 'center' }}>
            <span className="crm__mark" aria-hidden="true">L</span>
            LoyaltyLoop
          </span>
          <span className="muted small">Signing you in…</span>
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
  identity, setIdentity, reload,
}: {
  identity: Identity | null;
  setIdentity: (value: Identity | null) => void;
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();

  const onSignedIn = (session: SessionPayload) => {
    setIdentity({ user: session.user, merchant: session.merchant, subscription: session.subscription });
    navigate('/app');
  };

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

  return (
    <Routes>
      <Route path="/" element={<SiteLayout signedIn={Boolean(identity)} />}>
        <Route index element={<Landing />} />
      </Route>
      <Route
        path="/signin"
        element={identity ? <Navigate to="/app" replace /> : <SignIn onSignedIn={onSignedIn} />}
      />
      <Route
        path="/signup"
        element={identity ? <Navigate to="/app" replace /> : <SignUp onSignedIn={onSignedIn} />}
      />
      <Route
        path="/app/*"
        element={session ? <CrmShell session={session} /> : <Navigate to="/signin" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function SiteLayout({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="site">
      <header className="site__nav">
        <Link className="site__logo" to="/">
          <span className="crm__mark" aria-hidden="true">L</span>
          LoyaltyLoop
        </Link>
        <nav className="site__links grow">
          <a className="site__link" href="/#pricing">Pricing</a>
          <a className="site__link" href="/#security">Security</a>
        </nav>
        <div className="row">
          {signedIn ? (
            <Link className="btn btn--sm" to="/app">Open my CRM</Link>
          ) : (
            <>
              <Link className="btn btn--sm btn--ghost" to="/signin">Sign in</Link>
              <Link className="btn btn--sm" to="/signup">Start free trial</Link>
            </>
          )}
        </div>
      </header>

      <Landing />

      <footer className="site__footer">
        <div className="site__inner row row--between row--wrap">
          <span>© {new Date().getFullYear()} LoyaltyLoop. Customer retention for cafés and chains.</span>
          <span className="row" style={{ gap: 16 }}>
            <a className="site__link" href="/#pricing">Pricing</a>
            <a className="site__link" href="/#security">Security</a>
            <Link className="site__link" to="/signin">Sign in</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  minimumRole?: 'manager' | 'owner';
  end?: boolean;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Every day',
    items: [
      { to: '/app', label: 'Dashboard', icon: '📊', end: true },
      { to: '/app/counter', label: 'Counter', icon: '⚡' },
      { to: '/app/members', label: 'Members', icon: '👥' },
      { to: '/app/redemptions', label: 'Redemptions', icon: '🎟️' },
      { to: '/app/activity', label: 'Activity', icon: '🧾' },
    ],
  },
  {
    group: 'Your programme',
    items: [
      { to: '/app/rewards', label: 'Rewards', icon: '🎁', minimumRole: 'manager' },
      { to: '/app/tiers', label: 'Tiers', icon: '🏅', minimumRole: 'manager' },
      { to: '/app/campaigns', label: 'Campaigns', icon: '🎯', minimumRole: 'manager' },
      { to: '/app/products', label: 'Menu', icon: '☕', minimumRole: 'manager' },
      { to: '/app/locations', label: 'Locations', icon: '📍', minimumRole: 'manager' },
    ],
  },
  {
    group: 'Account',
    items: [
      { to: '/app/team', label: 'Team & keys', icon: '🔑', minimumRole: 'manager' },
      { to: '/app/billing', label: 'Billing', icon: '💳', minimumRole: 'owner' },
      { to: '/app/settings', label: 'Settings', icon: '⚙️', minimumRole: 'owner' },
      { to: '/app/audit', label: 'Audit log', icon: '🛡️', minimumRole: 'manager' },
    ],
  },
];

const TITLES: [RegExp, string][] = [
  [/^\/app\/counter/, 'Counter'],
  [/^\/app\/members\/.+/, 'Member'],
  [/^\/app\/members/, 'Members'],
  [/^\/app\/redemptions/, 'Redemptions'],
  [/^\/app\/activity/, 'Activity'],
  [/^\/app\/rewards/, 'Rewards'],
  [/^\/app\/tiers/, 'Tiers'],
  [/^\/app\/campaigns/, 'Campaigns'],
  [/^\/app\/products/, 'Menu'],
  [/^\/app\/locations/, 'Locations'],
  [/^\/app\/team/, 'Team & keys'],
  [/^\/app\/billing/, 'Billing'],
  [/^\/app\/settings/, 'Settings'],
  [/^\/app\/audit/, 'Audit log'],
  [/^\/app/, 'Dashboard'],
];

function CrmShell({ session }: { session: SessionValue }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const title = TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] ?? 'Dashboard';

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const { subscription, merchant, user } = session;
  const showTrialBanner =
    subscription.status === 'trialing' && (subscription.trialDaysLeft ?? 99) <= 7;

  return (
    <SessionContext.Provider value={session}>
      <div className={`crm ${menuOpen ? 'crm--open' : ''}`}>
        <aside className="crm__sidebar">
          <div className="crm__brand">
            <span className="crm__mark" style={{ background: merchant.brandColor }} aria-hidden="true">
              {merchant.name.slice(0, 1)}
            </span>
            <span className="truncate">{merchant.name}</span>
          </div>

          {NAV.map((group) => {
            const items = group.items.filter(
              (item) => !item.minimumRole || canAct(user.role, item.minimumRole),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.group}>
                <div className="crm__nav-group">{group.group}</div>
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className="crm__nav-item">
                    <span className="crm__nav-icon" aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}

          <div style={{ marginTop: 'auto', paddingTop: 16 }}>
            <div className="crm__nav-group">Signed in</div>
            <div style={{ padding: '0 10px 8px' }}>
              <div className="small strong truncate">{user.name}</div>
              <div className="tiny muted">{user.role}</div>
            </div>
            <button
              type="button"
              className="crm__nav-item"
              style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
              onClick={() => session.signOut()}
            >
              <span className="crm__nav-icon" aria-hidden="true">↩</span>
              Sign out
            </button>
          </div>
        </aside>

        {menuOpen ? <div className="scrim" onClick={() => setMenuOpen(false)} /> : null}

        <div className="crm__body">
          <header className="crm__topbar">
            <button
              type="button"
              className="iconbutton crm__menu-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Toggle navigation"
            >
              ☰
            </button>
            <h1 className="crm__title">{title}</h1>
            <span className="grow" />
            {subscription.status === 'trialing' ? (
              <span className="pill pill--info">
                Trial · {subscription.trialDaysLeft ?? 0} days left
              </span>
            ) : null}
            <Link className="btn btn--sm" to="/app/counter">Award points</Link>
          </header>

          <div className="crm__content stack">
            {showTrialBanner && canAct(user.role, 'owner') ? (
              <div className="alert alert--warning row row--between row--wrap">
                <span>
                  Your free trial ends in {subscription.trialDaysLeft} day
                  {subscription.trialDaysLeft === 1 ? '' : 's'}. Pick a plan to keep your programme running.
                </span>
                <Link className="btn btn--sm" to="/app/billing">Choose a plan</Link>
              </div>
            ) : null}

            {!subscription.writable && subscription.reason ? (
              <div className="alert row row--between row--wrap">
                <span>{subscription.reason}</span>
                {canAct(user.role, 'owner') ? (
                  <Link className="btn btn--sm" to="/app/billing">Fix billing</Link>
                ) : null}
              </div>
            ) : null}

            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="counter" element={<Counter />} />
              <Route path="members" element={<Members />} />
              <Route path="members/:id" element={<MemberDetail />} />
              <Route path="redemptions" element={<Redemptions />} />
              <Route path="activity" element={<Activity />} />
              <Route path="rewards" element={<Rewards />} />
              <Route path="tiers" element={<Tiers />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="products" element={<Products />} />
              <Route path="locations" element={<Locations />} />
              <Route path="team" element={<Team />} />
              <Route path="billing" element={<Billing />} />
              <Route path="settings" element={<Settings />} />
              <Route path="audit" element={<AuditLog />} />
              <Route path="*" element={<Navigate to="/app" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </SessionContext.Provider>
  );
}
