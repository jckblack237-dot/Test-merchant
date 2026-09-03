/**
 * Thin API client.
 *
 * Access tokens are short-lived and kept in memory; only the refresh token is
 * persisted. On a 401 the client transparently refreshes once and replays the
 * request, so a token expiring mid-session is invisible to the user.
 */
const REFRESH_KEY = 'loyaltyloop.customer.refresh';

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setSession(tokens: { accessToken: string; refreshToken: string } | null): void {
  accessToken = tokens?.accessToken ?? null;
  try {
    if (tokens) localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* private browsing — the session simply won't survive a reload */
  }
  listeners.forEach((listener) => listener(Boolean(tokens)));
}

export function onSessionChange(listener: (signedIn: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasStoredSession(): boolean {
  return Boolean(getRefreshToken());
}

async function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  // Collapse concurrent 401s into a single refresh call.
  refreshPromise ??= (async () => {
    try {
      const response = await fetch('/api/auth/customer/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        setSession(null);
        return false;
      }
      const data = await response.json();
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  retry?: boolean;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 && options.retry !== false) {
    if (await refreshSession()) {
      return api<T>(path, { ...options, retry: false });
    }
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? 'error',
      error.message ?? 'Something went wrong.',
      error.details,
    );
  }
  return payload as T;
}

/** Restores a session from the stored refresh token on app start. */
export async function restoreSession(): Promise<boolean> {
  if (accessToken) return true;
  return refreshSession();
}

export async function signIn(email: string, password: string) {
  const data = await api<{ accessToken: string; refreshToken: string; customer: Customer }>(
    '/auth/customer/login',
    { method: 'POST', body: { email, password }, retry: false },
  );
  setSession(data);
  return data.customer;
}

export async function signUp(input: { name: string; email: string; password: string; phone?: string }) {
  const data = await api<{ accessToken: string; refreshToken: string; customer: Customer }>(
    '/auth/customer/signup',
    { method: 'POST', body: input, retry: false },
  );
  setSession(data);
  return data.customer;
}

export async function signOut(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await api('/auth/customer/logout', { method: 'POST', body: { refreshToken } }).catch(() => {});
  }
  setSession(null);
}

// --- Shared response types --------------------------------------------------

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface Merchant {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  category: string;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor: string;
  currency: string;
  pointsPerCurrency: number;
  signupBonusPoints: number;
  locationCount?: number;
}

export interface Tier {
  id: string;
  name: string;
  minLifetimePoints: number;
  multiplier: number;
  color: string;
  perks: string[];
}

export interface Membership {
  id: string;
  memberNumber: string;
  pointsBalance: number;
  lifetimePoints: number;
  pointsRedeemed: number;
  visits: number;
  totalSpendCents: number;
  status: string;
  joinedAt: string;
  lastActivityAt: string | null;
  merchant: Merchant;
  tier: Tier | null;
  nextTier: (Tier & { pointsToGo: number }) | null;
}

export interface Reward {
  id: string;
  name: string;
  description: string;
  pointsCost: number;
  category: string;
  stock: number;
  perMemberLimit: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  isFeatured: boolean;
}

export interface Location {
  id: string;
  name: string;
  addressLine1: string;
  city: string;
  openingHours: string;
  phone: string | null;
}

export interface ActivityEntry {
  id: string;
  type: string;
  pointsDelta: number;
  balanceAfter: number;
  amountCents: number;
  note: string;
  items: { id: string; name: string; price_cents: number }[];
  createdAt: string;
}

export interface Redemption {
  id: string;
  code: string;
  status: string;
  pointsSpent: number;
  createdAt: string;
  expiresAt: string | null;
  fulfilledAt: string | null;
  reward: { id: string; name: string; description: string } | null;
  merchant: { id: string; name: string; brandColor: string };
}
