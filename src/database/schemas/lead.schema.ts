import mongoose, { Schema } from "mongoose";
import { ILeadDocument } from "../../types";

// ─── Lead Schema ─────────────────────────────────────────

const leadSchema = new Schema<ILeadDocument>(
  {
    company: {
      type: String,
      required: true,
      trim: true,
    },
    contactName: {
      type: String,
      required: true,
      trim: true,
    },
    contactEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    contactPhone: {
      type: String,
      trim: true,
    },
    contactTitle: {
      type: String,
      trim: true,
    },
    industry: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
    },
    dealStage: {
      type: String,
      required: true,
      enum: [
        "prospecting",
        "qualified",
        "proposal",
        "negotiation",
        "closed_won",
        "closed_lost",
      ],
      default: "prospecting",
    },
    companySize: {
      type: String,
      required: true,
      enum: ["startup", "mid-market", "enterprise", "unknown"],
      default: "unknown",
    },
    estimatedValue: {
      type: Number,
      min: 0,
    },
    source: {
      type: String,
      required: true,
      enum: [
        "website",
        "referral",
        "linkedin",
        "cold_call",
        "conference",
        "partner",
        "other",
      ],
      default: "other",
    },
    priority: {
      type: String,
      required: true,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    tags: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
      default: "",
    },
    lastContactedAt: {
      type: Date,
    },
    nextFollowUp: {
      type: Date,
    },
  },
  {
    timestamps: true, // auto createdAt + updatedAt
  }
);

// ─── Indexes ─────────────────────────────────────────────
// Filter-path indexes: the most common query patterns
leadSchema.index({ industry: 1, location: 1 });       // "fintech leads in NYC"
leadSchema.index({ dealStage: 1 });                    // filter by pipeline stage
leadSchema.index({ priority: 1, dealStage: 1 });       // high-priority qualified leads
leadSchema.index({ nextFollowUp: 1 });                 // follow-up due query
leadSchema.index({ contactEmail: 1 }, { unique: true });// prevent duplicate leads

// Text index for free-text search across company, name, notes
leadSchema.index(
  { company: "text", contactName: "text", notes: "text" },
  { name: "lead_text_search" }
);

export const LeadModel = mongoose.model<ILeadDocument>("Lead", leadSchema);
