import {
  UserPreferencesModel,
  InteractionLogModel,
  FeedbackRecordModel,
} from "../database";
import {
  UserPreferences,
  InteractionLog,
  MemoryUpdate,
  MemoryExtractionResult,
  MemorySnapshot,
  FeedbackRecord,
  IInteractionLogDocument,
  IUserPreferencesDocument,
  IFeedbackRecordDocument,
} from "../types";
import { MemoryExtractor } from "./memory.extractor";
import { ILLMProvider } from "./llm.provider";

// ─── Default Preferences ─────────────────────────────────

function defaultPreferences(userId: string): UserPreferences {
  return {
    userId,
    tone: "professional",
    preferredLength: "medium",
    signature: "",
    signOff: "Best regards",
    senderName: "",
    senderTitle: "",
    companyName: "",
    avoidPhrases: [],
    styleNotes: [],
    preferredTemplates: [],
    updatedAt: new Date(),
  };
}

function docToPreferences(doc: IUserPreferencesDocument): UserPreferences {
  return {
    userId: doc.userId,
    tone: doc.tone ?? "professional",
    preferredLength: doc.preferredLength ?? "medium",
    signature: doc.signature ?? "",
    signOff: doc.signOff ?? "Best regards",
    senderName: doc.senderName ?? "",
    senderTitle: doc.senderTitle ?? "",
    companyName: doc.companyName ?? "",
    avoidPhrases: doc.avoidPhrases ?? [],
    styleNotes: doc.styleNotes ?? [],
    preferredTemplates: doc.preferredTemplates ?? [],
    updatedAt: doc.updatedAt ?? new Date(),
  };
}

// ─── MemoryService ───────────────────────────────────────

/**
 * MemoryService — reads / writes user preferences, processes feedback,
 * and maintains the memory evolution history.
 *
 * ## Key capabilities
 *
 * - **getPreferences / updatePreferences** — CRUD for user prefs (unchanged API).
 * - **applyFeedback(userId, feedback)** — the main new entry-point.
 *   Uses MemoryExtractor to parse natural-language feedback, applies the
 *   resulting MemoryUpdates, and records a FeedbackRecord for audit.
 * - **applyUpdates(userId, updates)** — lower-level: apply a list of
 *   MemoryUpdate objects directly (useful when ThinkerAgent already
 *   extracted the updates).
 * - **getSnapshot(userId)** — returns a full MemorySnapshot for
 *   debugging, reasoning traces, or UI display.
 */
export class MemoryService {
  private extractor: MemoryExtractor;

  /**
   * @param llmProvider Optional LLM provider for hybrid (rule + LLM)
   *   feedback extraction. Pass `undefined` for rules-only mode.
   */
  constructor(llmProvider?: ILLMProvider) {
    this.extractor = new MemoryExtractor(llmProvider);
  }

  // ── Read ───────────────────────────────────────────────

  /** Load user preferences. Returns sensible defaults if none exist. */
  async getPreferences(userId: string): Promise<UserPreferences> {
    const doc = await UserPreferencesModel.findOne({ userId })
      .lean<IUserPreferencesDocument>()
      .exec();

    return doc ? docToPreferences(doc) : defaultPreferences(userId);
  }

  // ── Write (full replace) ───────────────────────────────

  /** Upsert user preferences (full object replace). */
  async updatePreferences(prefs: UserPreferences): Promise<void> {
    await UserPreferencesModel.findOneAndUpdate(
      { userId: prefs.userId },
      { $set: prefs },
      { upsert: true, returnDocument: "after" }
    ).exec();
  }

  // ── Feedback Processing (the main new feature) ─────────

  /**
   * Parse natural-language feedback, extract preference updates,
   * apply them, and record a FeedbackRecord for audit.
   *
   * @returns The extraction result (including what changed and explanations).
   */
  async applyFeedback(
    userId: string,
    feedback: string
  ): Promise<MemoryExtractionResult> {
    // 1. Extract structured updates from the feedback text
    const extraction = await this.extractor.extract(feedback);

    if (!extraction.detected || extraction.updates.length === 0) {
      return extraction; // nothing to apply
    }

    // 2. Apply the updates and record the change
    await this.applyUpdates(userId, extraction.updates, feedback);

    return extraction;
  }

  /**
   * Apply a list of MemoryUpdate objects to a user's preferences.
   * Records a FeedbackRecord with before/after snapshots.
   *
   * This is the lower-level API — used internally by applyFeedback()
   * and can also be called directly by the ThinkerAgent.
   */
  async applyUpdates(
    userId: string,
    updates: MemoryUpdate[],
    feedbackText = ""
  ): Promise<UserPreferences> {
    const before = await this.getPreferences(userId);

    // Build a shallow copy and apply each update
    const after = { ...before };
    const previousValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    for (const update of updates) {
      const field = update.field as keyof UserPreferences;
      previousValues[field] = this.cloneField(before[field]);

      this.applyOneUpdate(after, update);

      newValues[field] = this.cloneField(after[field]);
    }

    // Persist updated prefs
    after.updatedAt = new Date();
    await this.updatePreferences(after);

    // Record the feedback for audit / memory evolution
    await FeedbackRecordModel.create({
      userId,
      feedback: feedbackText || updates.map((u) => u.source).join("; "),
      updates,
      previousValues,
      newValues,
      timestamp: new Date(),
    });

    return after;
  }

  // ── Snapshot ───────────────────────────────────────────

  /**
   * Returns a full memory snapshot: current preferences + recent feedback
   * history. Useful for debugging, reasoning traces, or UI display.
   */
  async getSnapshot(userId: string, feedbackLimit = 10): Promise<MemorySnapshot> {
    const [preferences, recentFeedback, feedbackCount] = await Promise.all([
      this.getPreferences(userId),
      this.getRecentFeedback(userId, feedbackLimit),
      FeedbackRecordModel.countDocuments({ userId }).exec(),
    ]);

    return {
      preferences,
      recentFeedback,
      feedbackCount,
      lastUpdated: preferences.updatedAt,
    };
  }

  // ── Feedback History ───────────────────────────────────

  /** Get recent feedback records (most recent first). */
  async getRecentFeedback(
    userId: string,
    limit = 10
  ): Promise<FeedbackRecord[]> {
    const docs = await FeedbackRecordModel.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean<IFeedbackRecordDocument[]>()
      .exec();

    return docs.map((doc) => ({
      userId: doc.userId,
      feedback: doc.feedback,
      updates: doc.updates,
      previousValues: doc.previousValues,
      newValues: doc.newValues,
      timestamp: doc.timestamp,
    }));
  }

  // ── Interaction Log (unchanged) ────────────────────────

  /** Append an interaction to the history log. */
  async logInteraction(log: InteractionLog): Promise<void> {
    await InteractionLogModel.create({
      ...log,
      timestamp: new Date(),
    });
  }

  /** Retrieve recent interactions for context. */
  async getRecentInteractions(
    userId: string,
    limit = 10
  ): Promise<InteractionLog[]> {
    const docs = await InteractionLogModel.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean<IInteractionLogDocument[]>()
      .exec();

    return docs.map((doc) => ({
      userId: doc.userId,
      request: doc.request,
      intent: doc.intent,
      agentsUsed: doc.agentsUsed,
      outcomeSummary: doc.outcomeSummary,
      reasoning: doc.reasoning,
      timestamp: doc.timestamp,
    }));
  }

  // ── Expose extractor for direct use ────────────────────

  /** Get the underlying MemoryExtractor (for testing / direct use). */
  getExtractor(): MemoryExtractor {
    return this.extractor;
  }

  // ── Private helpers ────────────────────────────────────

  /**
   * Apply a single MemoryUpdate to a mutable preferences object.
   */
  private applyOneUpdate(
    prefs: UserPreferences,
    update: MemoryUpdate
  ): void {
    const { field, value, operation } = update;
    const rec = prefs as unknown as Record<string, unknown>;

    switch (operation) {
      case "set":
        rec[field] = value;
        break;

      case "append": {
        const arr = rec[field];
        if (Array.isArray(arr)) {
          const strVal = String(value).toLowerCase();
          if (!arr.some((v: string) => v.toLowerCase() === strVal)) {
            arr.push(String(value));
          }
        }
        break;
      }

      case "remove": {
        const arr2 = rec[field];
        if (Array.isArray(arr2)) {
          const strVal = String(value).toLowerCase();
          rec[field] = arr2.filter(
            (v: string) => v.toLowerCase() !== strVal
          );
        }
        break;
      }
    }
  }

  private cloneField(val: unknown): unknown {
    if (Array.isArray(val)) return [...val];
    if (val instanceof Date) return new Date(val.getTime());
    return val;
  }
}
