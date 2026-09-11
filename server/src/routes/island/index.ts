import { Router } from 'express';
import { requireMerchantAuth, requireStaffSession } from '../../middleware/auth';
import { agentsRouter } from './agents';
import { missionsRouter } from './missions';

/**
 * Everything under /api/island.
 *
 * Same shape as the merchant subtree: authentication runs once for the whole
 * router, so no route below can be reached without a principal and every one of
 * them gets a `req.store` already locked to that principal's merchant. A
 * mission asks a question about a merchant's own strategy, and the answer names
 * their competitors — it is some of the most sensitive data in the product.
 *
 * The staff-session requirement goes further than the rest of the API: a
 * point-of-sale API key belongs at a till and has no business reading, starting
 * or stopping the island's work.
 */
export const islandRouter = Router();
islandRouter.use(requireMerchantAuth);
islandRouter.use(requireStaffSession);

islandRouter.use('/agents', agentsRouter);
islandRouter.use('/missions', missionsRouter);
