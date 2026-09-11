import { createContext, useContext } from 'react';
import type { MerchantProfile, MerchantUser } from './api';

export interface SessionValue {
  user: MerchantUser;
  merchant: MerchantProfile;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside the island shell.');
  return value;
}

const RANK = { staff: 1, manager: 2, owner: 3 } as const;

/** Mirrors the server's role gate so the UI hides what the API would refuse. */
export function canAct(role: MerchantUser['role'], minimum: keyof typeof RANK): boolean {
  return RANK[role] >= RANK[minimum];
}
