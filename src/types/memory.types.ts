// ─── Memory / User Preferences Types ─────────────────────

import { Document, Types } from "mongoose";
import { ExecutionPlan, PlannerOutput, ReasoningStep } from "./reasoning.types";

// ─── Preference Enums ────────────────────────────────────

/** Allowed tone presets for email generation. */
export type PreferenceTone =
  | "professional"
  | "friendly"
  | "casual"
  | "formal"
  | "assertive"
  | "consultative"
  | "direct";

/** Length guidance stored in memory. */
export type PreferenceLength = "short" | "medium" | "long" | "detailed";

// ─── User Preferences ───────────────────────────────────

export interface UserPreferences {
  userId: string;
  /** Email tone — injected into prompt system prompt. */
  tone: PreferenceTone;
  /** Preferred email length — maps to word count in the prompt. */
  preferredLength: PreferenceLength;
  /** Full signature block (multi-line). */
  signature: string;
  /** Closing line before signature (e.g. "Best regards"). */
  signOff: string;
  senderName: string;
  senderTitle: string;
  companyName: string;
  /** Phrases the LLM must never use. */
  avoidPhrases: string[];
  /** Extra style instructions applied to every email. */
  styleNotes: string[];
  preferredTemplates: string[];
  updatedAt: Date;
}

/** Mongoose document interface for user preferences. */
export interface IUserPreferencesDocument
  extends UserPreferences,
    Document {
  _id: Types.ObjectId;
}

// ─── Feedback & Memory Evolution ─────────────────────────

/**
 * The fields in UserPreferences that can be mutated by feedback.
 * Used by the MemoryExtractor and MemoryService.
 */
export type UpdatableField =
  | "tone"
  | "preferredLength"
  | "signature"
  | "signOff"
  | "senderName"
  | "senderTitle"
  | "companyName"
  | "avoidPhrases"
  | "styleNotes";

/**
 * A single atomic update to one preference field.
 * Produced by the MemoryExtractor from user feedback.
 */
export interface MemoryUpdate {
  field: UpdatableField;
  /** The new value (type depends on the field). */
  value: string | string[];
  /**
   * How the value should be applied:
   *  - "set"    — overwrite the current value
   *  - "append" — add to an array field (avoidPhrases, styleNotes)
   *  - "remove" — remove from an array field
   */
  operation: "set" | "append" | "remove";
  /** The original text that triggered this update. */
  source: string;
  /** Confidence score (0–1). Rules = 1.0, LLM = 0.6–0.9. */
  confidence: number;
}

/**
 * Result of extracting memory updates from user feedback.
 * Returned by MemoryExtractor.extract().
 */
export interface MemoryExtractionResult {
  /** The updates to apply (may be empty if no preference signal detected). */
  updates: MemoryUpdate[];
  /** Whether any preference signal was detected at all. */
  detected: boolean;
  /** Human-readable explanation of what was extracted. */
  explanation: string;
  /** Whether an LLM was used (vs. rules-only) to extract. */
  usedLLM: boolean;
}

/**
 * Persisted record of a feedback event + what changed.
 * Allows auditing how preferences evolved over time.
 */
export interface FeedbackRecord {
  userId: string;
  /** The raw user feedback text. */
  feedback: string;
  /** The updates that were applied. */
  updates: MemoryUpdate[];
  /** Snapshot of preferences BEFORE the updates. */
  previousValues: Record<string, unknown>;
  /** Snapshot of preferences AFTER the updates. */
  newValues: Record<string, unknown>;
  timestamp: Date;
}

/** Mongoose document interface for feedback records. */
export interface IFeedbackRecordDocument
  extends FeedbackRecord,
    Document {
  _id: Types.ObjectId;
}

// ─── Interaction Log ─────────────────────────────────────

export interface InteractionLog {
  userId: string;
  request: string;
  intent: string;
  agentsUsed: string[];
  outcomeSummary: string;
  reasoning?: {
    plan: ExecutionPlan;
    rawPlan?: PlannerOutput;
    taskBreakdown: string[];
    agentsPlanned: string[];
    entities?: PlannerOutput["entities"];
    leadQuery?: PlannerOutput["leadQuery"];
    emailType?: string;
    customInstructions?: string;
    reasoningTrace: ReasoningStep[];
    decisions?: Array<{
      decision: string;
      reason: string;
      source: "memory" | "default" | "user_request" | "llm";
    }>;
    confidence: number;
    usage?: {
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalTokens: number;
      estimatedCost: number;
      llmCalls: number;
    };
    totalDurationMs?: number;
  };
  timestamp: Date;
}

/** Mongoose document interface for interaction logs. */
export interface IInteractionLogDocument
  extends InteractionLog,
    Document {
  _id: Types.ObjectId;
}

// ─── Memory Snapshot (for debugging / UI) ────────────────

/**
 * A full read-only snapshot of a user's memory state.
 * Useful for debugging, UI display, and reasoning-trace injection.
 */
export interface MemorySnapshot {
  preferences: UserPreferences;
  recentFeedback: FeedbackRecord[];
  feedbackCount: number;
  lastUpdated: Date;
}
