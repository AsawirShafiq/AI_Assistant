import mongoose, { Schema } from "mongoose";
import {
  IUserPreferencesDocument,
  IInteractionLogDocument,
  IFeedbackRecordDocument,
} from "../../types";

// ─── User Preferences Schema ────────────────────────────

const userPreferencesSchema = new Schema<IUserPreferencesDocument>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    tone: {
      type: String,
      default: "professional",
      trim: true,
    },
    preferredLength: {
      type: String,
      default: "medium",
      trim: true,
    },
    signature: {
      type: String,
      default: "",
      trim: true,
    },
    signOff: {
      type: String,
      default: "Best regards",
      trim: true,
    },
    senderName: {
      type: String,
      default: "",
      trim: true,
    },
    senderTitle: {
      type: String,
      default: "",
      trim: true,
    },
    companyName: {
      type: String,
      default: "",
      trim: true,
    },
    avoidPhrases: {
      type: [String],
      default: [],
    },
    styleNotes: {
      type: [String],
      default: [],
    },
    preferredTemplates: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: true }, // only updatedAt
  }
);

// ─── Feedback Record Schema ─────────────────────────────

const memoryUpdateSubSchema = new Schema(
  {
    field: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    operation: {
      type: String,
      enum: ["set", "append", "remove"],
      required: true,
    },
    source: { type: String, required: true },
    confidence: { type: Number, required: true },
  },
  { _id: false }
);

const feedbackRecordSchema = new Schema<IFeedbackRecordDocument>(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
    },
    feedback: {
      type: String,
      required: true,
    },
    updates: {
      type: [memoryUpdateSubSchema],
      default: [],
    },
    previousValues: {
      type: Schema.Types.Mixed,
      default: {},
    },
    newValues: {
      type: Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

// ─── Interaction Log Schema ─────────────────────────────

const interactionLogSchema = new Schema<IInteractionLogDocument>(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
    },
    request: {
      type: String,
      required: true,
    },
    intent: {
      type: String,
      required: true,
    },
    agentsUsed: {
      type: [String],
      default: [],
    },
    outcomeSummary: {
      type: String,
      default: "",
    },
    reasoning: {
      type: Schema.Types.Mixed,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false, // we manage timestamp field manually
  }
);

// ─── Indexes ─────────────────────────────────────────────

interactionLogSchema.index({ userId: 1, timestamp: -1 }); // recent-first queries
interactionLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7_776_000 }); // TTL: 90 days

feedbackRecordSchema.index({ userId: 1, timestamp: -1 }); // recent feedback
feedbackRecordSchema.index({ timestamp: 1 }, { expireAfterSeconds: 15_552_000 }); // TTL: 180 days

// ─── Models ──────────────────────────────────────────────

export const UserPreferencesModel = mongoose.model<IUserPreferencesDocument>(
  "UserPreference",
  userPreferencesSchema
);

export const InteractionLogModel = mongoose.model<IInteractionLogDocument>(
  "InteractionLog",
  interactionLogSchema
);

export const FeedbackRecordModel = mongoose.model<IFeedbackRecordDocument>(
  "FeedbackRecord",
  feedbackRecordSchema
);
