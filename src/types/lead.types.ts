// ─── Lead Types ──────────────────────────────────────────

import { Document, Types } from "mongoose";

export type DealStage =
  | "prospecting"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

export type CompanySize = "startup" | "mid-market" | "enterprise" | "unknown";

export type LeadSource =
  | "website"
  | "referral"
  | "linkedin"
  | "cold_call"
  | "conference"
  | "partner"
  | "other";

export type Priority = "low" | "medium" | "high";

/** Plain lead object returned by the API / agents. */
export interface Lead {
  id: string;
  company: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  contactTitle?: string;
  industry: string;
  location: string;
  dealStage: DealStage;
  companySize: CompanySize;
  estimatedValue?: number;
  source: LeadSource;
  priority: Priority;
  tags: string[];
  notes: string;
  lastContactedAt?: Date;
  nextFollowUp?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Mongoose document interface. */
export interface ILeadDocument extends Omit<Lead, "id">, Document {
  _id: Types.ObjectId;
}

/** Sort‑key options for lead queries. */
export type LeadSortField =
  | "company"
  | "contactName"
  | "priority"
  | "estimatedValue"
  | "dealStage"
  | "createdAt"
  | "updatedAt"
  | "nextFollowUp";

/** Query filters accepted by the LeadAgent / LeadService. */
export interface LeadQuery {
  /* ── Filter fields ──────────────────────────────────── */
  /** Partial, case-insensitive match on contactName. */
  name?: string;
  /** Partial, case-insensitive match on company. */
  company?: string;
  /** Partial, case-insensitive match on industry. */
  industry?: string;
  /** Partial, case-insensitive match on location. */
  location?: string;
  /** Exact match on pipeline stage. */
  dealStage?: DealStage;
  /** Exact match on company size bucket. */
  companySize?: CompanySize;
  /** Exact match on lead source. */
  source?: LeadSource;
  /** Exact match on priority level. */
  priority?: Priority;
  /** Full-text search across company, contactName, notes. */
  search?: string;
  /** If true, return leads whose nextFollowUp ≤ now. */
  needsFollowUp?: boolean;
  /** Filter by one or more tags (AND logic). */
  tags?: string[];
  /** Minimum estimated deal value. */
  minValue?: number;
  /** Maximum estimated deal value. */
  maxValue?: number;

  /* ── Pagination / sorting ───────────────────────────── */
  limit?: number;
  skip?: number;
  sortBy?: LeadSortField;
  sortOrder?: "asc" | "desc";
}

/** Structured result wrapper returned by LeadAgent.execute(). */
export interface LeadAgentResult {
  /** The matching leads. */
  leads: Lead[];
  /** Total count of documents matching the filter (ignoring limit/skip). */
  totalCount: number;
  /** The query that produced this result (for traceability). */
  query: LeadQuery;
  /** Wall-clock ms the query took. */
  durationMs: number;
}
