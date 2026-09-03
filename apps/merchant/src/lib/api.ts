/**
 * Thin API client.
 *
 * Access tokens are short-lived and kept in memory; only the refresh token is
 * persisted. On a 401 the client transparently refreshes once and replays the
 * request, so a token expiring mid-session is invisible to the user.
 */
const REFRESH_KEY = 'loyaltyloop.merchant.refresh';

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
      const response = await fetch('/api/auth/merchant/refresh', {
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

export interface MerchantUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'manager' | 'staff';
}

export interface MerchantProfile {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  category: string;
  logoUrl: string | null;
  brandColor: string;
  currency: string;
  country: string;
  timezone?: string;
  pointsPerCurrency: number;
  signupBonusPoints: number;
  pointsExpiryDays: number | null;
  redeemNeedsStaff?: boolean;
  isListed: boolean;
  planCode: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
}

export interface Subscription {
  plan: { code: string; name: string; price_cents: number; max_locations: number; max_staff: number; max_members: number };
  status: string;
  writable: boolean;
  trialDaysLeft: number | null;
  renewsAt: string | null;
  reason?: string;
}

export interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  user: MerchantUser;
  merchant: MerchantProfile;
  subscription: Subscription;
}

export async function signIn(email: string, password: string): Promise<SessionPayload> {
  const data = await api<SessionPayload>('/auth/merchant/login', {
    method: 'POST',
    body: { email, password },
    retry: false,
  });
  setSession(data);
  return data;
}

export interface SignUpInput {
  businessName: string;
  ownerName: string;
  email: string;
  password: string;
  planCode: string;
}

export async function signUp(input: SignUpInput): Promise<SessionPayload> {
  const data = await api<SessionPayload>('/auth/merchant/signup', {
    method: 'POST',
    body: input,
    retry: false,
  });
  setSession(data);
  return data;
}

export async function signOut(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await api('/auth/merchant/logout', { method: 'POST', body: { refreshToken } }).catch(() => {});
  }
  setSession(null);
}

export async function fetchMe() {
  return api<{ user: MerchantUser; merchant: MerchantProfile; subscription: Subscription }>(
    '/auth/merchant/me',
  );
}

// --- CRM response types -----------------------------------------------------

export interface Member {
  id: string;
  memberNumber: string;
  name: string;
  email: string;
  phone: string | null;
  pointsBalance: number;
  lifetimePoints: number;
  pointsRedeemed: number;
  visits: number;
  totalSpendCents: number;
  status: 'active' | 'blocked';
  tierId: string | null;
  tierName: string | null;
  tierColor: string | null;
  joinedAt: string;
  lastActivityAt: string | null;
}

export interface LedgerEntry {
  id: string;
  type: string;
  pointsDelta: number;
  balanceAfter: number;
  amountCents: number;
  note: string;
  source: string;
  reference: string | null;
  items: { id: string; name: string; price_cents: number }[];
  createdAt: string;
  customerName?: string;
  memberNumber?: string;
  locationName?: string | null;
  staffName?: string | null;
}

export interface Dashboard {
  periodDays: number;
  members: { total: number; active: number; new: number; pointsOutstanding: number; lifetimePointsIssued: number };
  period: {
    transactions: number; pointsIssued: number; revenueCents: number; visits: number;
    revenueChangePct: number | null; visitsChangePct: number | null;
  };
  redemptions: { total: number; pending: number; pointsSpent: number };
  series: { day: string; points: number; revenue_cents: number; visits: number }[];
  topMembers: Member[];
  byLocation: { locationId: string | null; name: string; revenueCents: number; visits: number }[];
  tiers: { id: string; name: string; color: string; minLifetimePoints: number; memberCount: number }[];
  usage: { locations: number; staff: number; members: number };
  subscription: Subscription;
}

export interface CatalogItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface RedemptionRow {
  id: string;
  code: string;
  status: string;
  pointsSpent: number;
  rewardName: string;
  customerName: string;
  memberNumber: string;
  membershipId: string;
  createdAt: string;
  expiresAt: string | null;
  fulfilledAt: string | null;
}

export interface AuditEntry {
  id: string;
  actorType: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface PlanOption {
  code: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  interval: string;
  limits: { locations: number; staff: number; members: number };
  features: string[];
}
