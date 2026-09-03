import type { NextFunction, Request, Response } from 'express';
import { paymentRequired, unauthorized } from '../lib/errors';
import { getMerchant, subscriptionState } from '../services/subscriptions';

/**
 * Gate for billable write operations.
 *
 * Reads stay open when a subscription lapses — a merchant must always be able
 * to see and export their own customer data, even after they stop paying. Only
 * the ability to keep *running* the programme is withheld.
 */
export function requireActiveSubscription(req: Request, _res: Response, next: NextFunction): void {
  try {
    const principal = req.merchant;
    if (!principal) throw unauthorized();
    const merchant = getMerchant(principal.merchantId);
    const state = subscriptionState(merchant);
    if (!state.writable) {
      throw paymentRequired(state.reason ?? 'An active subscription is required.', {
        status: state.status,
        plan: state.plan.code,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
}
