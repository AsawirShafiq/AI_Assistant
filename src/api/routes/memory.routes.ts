/**
 * /api/memory — Inspect & clear user memory (interaction logs + feedback)
 */

import { Router } from "express";
import { MemoryService } from "../../services/memory.service";
import { FeedbackRecordModel, InteractionLogModel } from "../../database";
import { asyncHandler } from "../middleware";

export function createMemoryRouter(memory: MemoryService): Router {
  const router = Router();

  // ── GET /api/memory?userId=...&feedbackLimit=... ──────
  // Returns a full MemorySnapshot: preferences + feedback history
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = str(req.query.userId) ?? "default_user";
      const feedbackLimit = num(req.query.feedbackLimit, 20);

      const snapshot = await memory.getSnapshot(userId, feedbackLimit);
      res.json(snapshot);
    })
  );

  // ── DELETE /api/memory?userId=... ─────────────────────
  // Clears feedback records + interaction logs for the user
  router.delete(
    "/",
    asyncHandler(async (req, res) => {
      const userId = str(req.query.userId) ?? "default_user";

      const [feedbackResult, logResult] = await Promise.all([
        FeedbackRecordModel.deleteMany({ userId }).exec(),
        InteractionLogModel.deleteMany({ userId }).exec(),
      ]);

      res.json({
        message: `Memory cleared for user "${userId}"`,
        deletedFeedback: feedbackResult.deletedCount,
        deletedInteractions: logResult.deletedCount,
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
