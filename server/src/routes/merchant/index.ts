import { Router } from 'express';
import { requireMerchantAuth } from '../../middleware/auth';
import { dashboardRouter } from './dashboard';
import { membersRouter } from './members';
import { pointsRouter } from './points';
import { catalogRouter } from './catalog';
import { apiKeysRouter, teamRouter } from './team';
import { accountRouter } from './account';

/**
 * Everything under /api/merchant.
 *
 * requireMerchantAuth runs first for the whole subtree, so no route below can
 * be reached without a principal, and every one of them receives a `req.store`
 * already locked to that principal's merchant.
 */
export const merchantRouter = Router();
merchantRouter.use(requireMerchantAuth);

merchantRouter.use('/dashboard', dashboardRouter);
merchantRouter.use('/members', membersRouter);
merchantRouter.use('/points', pointsRouter);
merchantRouter.use('/catalog', catalogRouter);
merchantRouter.use('/team', teamRouter);
merchantRouter.use('/api-keys', apiKeysRouter);
merchantRouter.use('/account', accountRouter);
