/**
 * /api/preferences — CRUD for user email preferences
 */

import { Router } from "express";
import { MemoryService } from "../../services/memory.service";
import { UserPreferencesModel } from "../../database";
import { asyncHandler } from "../middleware";

/** Fields users are allowed to set on preferences — prevents injection. */
const ALLOWED_PREF_FIELDS = [
  "tone", "preferredLength", "signature", "signOff",
  "senderName", "senderTitle", "companyName",
  "avoidPhrases", "styleNotes", "preferredTemplates",
] as const;

/** Pick only allowed keys from a request body. */
function pickPrefFields(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ALLOWED_PREF_FIELDS) {
    if (key in body) result[key] = body[key];
  }
  return result;
}

export function createPreferencesRouter(memory: MemoryService): Router {
  const router = Router();

  // ── GET /api/preferences?userId=... ───────────────────
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = str(req.query.userId) ?? "default_user";
      const prefs = await memory.getPreferences(userId);
      res.json(prefs);
    })
  );

  // ── POST /api/preferences ─────────────────────────────
  // Create preferences for a new user
  // Body: { userId, tone?, preferredLength?, signOff?, ... }
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { userId } = req.body;
      if (!userId || typeof userId !== "string") {
        res.status(400).json({
          status: 400,
          error: "Bad Request",
          message: '"userId" is required.',
        });
        return;
      }

      // Check if prefs already exist
      const existing = await UserPreferencesModel.findOne({ userId })
        .lean()
        .exec();
      if (existing) {
        res.status(409).json({
          status: 409,
          error: "Conflict",
          message: `Preferences for "${userId}" already exist. Use PUT to update.`,
        });
        return;
      }

      // Merge with defaults
      const defaults = await memory.getPreferences(userId); // generates defaults
      const sanitized = pickPrefFields(req.body);
      const merged = { ...defaults, ...sanitized, userId, updatedAt: new Date() };
      await memory.updatePreferences(merged);

      res.status(201).json(merged);
    })
  );

  // ── PUT /api/preferences?userId=... ───────────────────
  // Partial update — only send the fields you want to change
  router.put(
    "/",
    asyncHandler(async (req, res) => {
      const userId =
        str(req.query.userId) ?? req.body.userId ?? "default_user";

      const current = await memory.getPreferences(userId);
      const sanitized = pickPrefFields(req.body);
      const updated = {
        ...current,
        ...sanitized,
        userId, // ensure userId isn't overwritten
        updatedAt: new Date(),
      };

      await memory.updatePreferences(updated);
      res.json(updated);
    })
  );

  return router;
}

// ─── Helpers ─────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
