/**
 * GET /api/analytics — Usage analytics and system metrics
 *
 * Aggregates interaction logs to show:
 *  - Total queries processed
 *  - Intent distribution
 *  - Top industries queried
 *  - Preference evolution timeline
 *  - Average response patterns
 */

import { Router } from "express";
import { InteractionLogModel, FeedbackRecordModel } from "../../database";
import { LeadModel } from "../../database";
import { asyncHandler } from "../middleware";

export function createAnalyticsRouter(): Router {
  const router = Router();

  /**
   * GET /api/analytics?userId=...&days=30
   * Returns aggregated usage metrics.
   */
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = str(req.query.userId) ?? "default_user";
      const days = num(req.query.days, 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [
        totalQueries,
        intentDistribution,
        recentInteractions,
        feedbackCount,
        recentFeedback,
        leadStats,
      ] = await Promise.all([
        // Total queries
        InteractionLogModel.countDocuments({
          userId,
          timestamp: { $gte: since },
        }).exec(),

        // Intent distribution
        InteractionLogModel.aggregate<{ _id: string; count: number }>([
          { $match: { userId, timestamp: { $gte: since } } },
          { $group: { _id: "$intent", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]).exec(),

        // Recent interactions (last 10)
        InteractionLogModel.find({ userId })
          .sort({ timestamp: -1 })
          .limit(10)
          .lean()
          .exec(),

        // Feedback count
        FeedbackRecordModel.countDocuments({
          userId,
          timestamp: { $gte: since },
        }).exec(),

        // Recent feedback records
        FeedbackRecordModel.find({ userId })
          .sort({ timestamp: -1 })
          .limit(10)
          .lean()
          .exec(),

        // Lead pipeline stats
        LeadModel.aggregate<{ _id: string; count: number }>([
          { $group: { _id: "$dealStage", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]).exec(),
      ]);

      // Build intent distribution map
      const intents: Record<string, number> = {};
      for (const item of intentDistribution) {
        intents[item._id] = item.count;
      }

      // Build pipeline stats map
      const pipeline: Record<string, number> = {};
      for (const item of leadStats) {
        pipeline[item._id] = item.count;
      }

      // Build preference evolution timeline from feedback records
      const preferencesEvolution = recentFeedback.map((fb) => ({
        timestamp: fb.timestamp,
        feedback: fb.feedback,
        fieldsChanged: fb.updates?.map((u: { field: string; operation: string }) =>
          `${u.field} (${u.operation})`
        ) ?? [],
      }));

      res.json({
        period: { days, since: since.toISOString() },
        queries: {
          total: totalQueries,
          intentDistribution: intents,
        },
        feedback: {
          total: feedbackCount,
          preferencesEvolution,
        },
        pipeline,
        recentActivity: recentInteractions.map((i) => ({
          request: i.request,
          intent: i.intent,
          agentsUsed: i.agentsUsed,
          outcome: i.outcomeSummary,
          timestamp: i.timestamp,
        })),
      });
    })
  );

  return router;
}

// ─── Helpers ─────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
