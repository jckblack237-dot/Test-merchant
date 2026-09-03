import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors';
import { store } from '../../middleware/auth';
import { getMerchant, subscriptionState, usageFor } from '../../services/subscriptions';
import { loadTiers } from '../../services/loyalty';
import { shapeTier } from '../public';

export const dashboardRouter = Router();

/**
 * Headline numbers for the CRM home screen.
 *
 * Every aggregate below runs through TenantStore.query, which refuses any SQL
 * touching a tenant table without a bound merchant_id — so a reporting query
 * cannot accidentally sum another merchant's revenue into this dashboard.
 */
dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const previousSince = new Date(Date.now() - days * 2 * 86_400_000).toISOString();

    const totals = s.queryOne<{
      members: number; active_members: number; points_outstanding: number; lifetime_points: number;
    }>(
      `SELECT COUNT(*) AS members,
              SUM(CASE WHEN last_activity_at >= @since THEN 1 ELSE 0 END) AS active_members,
              COALESCE(SUM(points_balance), 0) AS points_outstanding,
              COALESCE(SUM(lifetime_points), 0) AS lifetime_points
       FROM memberships WHERE merchant_id = @merchantId`,
      { since },
    )!;

    const period = s.queryOne<{
      transactions: number; points_issued: number; revenue_cents: number; visits: number;
    }>(
      `SELECT COUNT(*) AS transactions,
              COALESCE(SUM(CASE WHEN points_delta > 0 THEN points_delta ELSE 0 END), 0) AS points_issued,
              COALESCE(SUM(amount_cents), 0) AS revenue_cents,
              COALESCE(SUM(CASE WHEN type = 'earn' THEN 1 ELSE 0 END), 0) AS visits
       FROM transactions WHERE merchant_id = @merchantId AND created_at >= @since`,
      { since },
    )!;

    const previousPeriod = s.queryOne<{ revenue_cents: number; visits: number }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS revenue_cents,
              COALESCE(SUM(CASE WHEN type = 'earn' THEN 1 ELSE 0 END), 0) AS visits
       FROM transactions
       WHERE merchant_id = @merchantId AND created_at >= @previousSince AND created_at < @since`,
      { since, previousSince },
    )!;

    const newMembers = s.count('memberships', 'joined_at >= @since', { since });

    const redemptions = s.queryOne<{ total: number; pending: number; points_spent: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              COALESCE(SUM(points_spent), 0) AS points_spent
       FROM redemptions WHERE merchant_id = @merchantId AND created_at >= @since`,
      { since },
    )!;

    // Daily series for the dashboard chart.
    const series = s.query<{ day: string; points: number; revenue_cents: number; visits: number }>(
      `SELECT substr(created_at, 1, 10) AS day,
              COALESCE(SUM(CASE WHEN points_delta > 0 THEN points_delta ELSE 0 END), 0) AS points,
              COALESCE(SUM(amount_cents), 0) AS revenue_cents,
              COUNT(*) AS visits
       FROM transactions
       WHERE merchant_id = @merchantId AND created_at >= @since
       GROUP BY day ORDER BY day`,
      { since },
    );

    const topMembers = s.query<Record<string, any>>(
      `SELECT m.id, m.member_number, m.points_balance, m.lifetime_points, m.visits,
              m.total_spend_cents, c.name, c.email
       FROM memberships m
       JOIN customers c ON c.id = m.customer_id
       WHERE m.merchant_id = @merchantId
       ORDER BY m.lifetime_points DESC
       LIMIT 5`,
    );

    const byLocation = s.query<{ location_id: string | null; name: string | null; revenue_cents: number; visits: number }>(
      `SELECT t.location_id, l.name, COALESCE(SUM(t.amount_cents), 0) AS revenue_cents, COUNT(*) AS visits
       FROM transactions t
       LEFT JOIN locations l ON l.id = t.location_id
       WHERE t.merchant_id = @merchantId AND t.created_at >= @since AND t.type = 'earn'
       GROUP BY t.location_id ORDER BY revenue_cents DESC`,
      { since },
    );

    const tiers = loadTiers(s);
    const tierBreakdown = tiers.map((tier) => ({
      ...shapeTier(tier as unknown as Record<string, any>),
      memberCount: s.count('memberships', 'tier_id = @tierId', { tierId: tier.id }),
    }));

    const merchant = getMerchant(s.merchantId);

    res.json({
      periodDays: days,
      members: {
        total: totals.members,
        active: totals.active_members ?? 0,
        new: newMembers,
        pointsOutstanding: totals.points_outstanding,
        lifetimePointsIssued: totals.lifetime_points,
      },
      period: {
        transactions: period.transactions,
        pointsIssued: period.points_issued,
        revenueCents: period.revenue_cents,
        visits: period.visits,
        revenueChangePct: percentChange(previousPeriod.revenue_cents, period.revenue_cents),
        visitsChangePct: percentChange(previousPeriod.visits, period.visits),
      },
      redemptions: {
        total: redemptions.total,
        pending: redemptions.pending ?? 0,
        pointsSpent: redemptions.points_spent,
      },
      series,
      topMembers: topMembers.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        memberNumber: row.member_number,
        pointsBalance: row.points_balance,
        lifetimePoints: row.lifetime_points,
        visits: row.visits,
        totalSpendCents: row.total_spend_cents,
      })),
      byLocation: byLocation.map((row) => ({
        locationId: row.location_id,
        name: row.name ?? 'Unassigned',
        revenueCents: row.revenue_cents,
        visits: row.visits,
      })),
      tiers: tierBreakdown,
      usage: usageFor(s),
      subscription: subscriptionState(merchant),
    });
  }),
);

function percentChange(previous: number, current: number): number | null {
  if (!previous) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
