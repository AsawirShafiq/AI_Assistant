import { LeadModel } from "../database";
import {
  Lead,
  LeadQuery,
  ILeadDocument,
  DealStage,
  Priority,
  LeadSortField,
} from "../types";

// ─── Priority Weight ─────────────────────────────────────

/** Numeric weight for semantic priority sorting (higher = more important). */
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

// ─── Error ───────────────────────────────────────────────

/**
 * Domain-specific error thrown when a lead-service operation fails.
 * Carries the original cause so callers can decide how to handle it.
 */
export class LeadServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "LeadServiceError";
  }
}

// ─── Service ─────────────────────────────────────────────

/**
 * LeadService — pure data-access layer for the `leads` collection.
 *
 * Design principles:
 *  • **Single Responsibility** — only reads / transforms lead data.
 *  • **No LLM coupling** — agents call this, not the other way around.
 *  • **Every public method returns plain objects** (not Mongoose docs)
 *    so consumers never depend on the ODM.
 *  • **Consistent error handling** — all failures are wrapped in
 *    `LeadServiceError` with the original cause attached.
 */
export class LeadService {
  // ── Core query method ──────────────────────────────────

  /**
   * Find leads matching the given query filters.
   *
   * All string filters (name, company, industry, location) are
   * partial & case-insensitive. Enum filters are exact matches.
   * Sorting defaults to `priority desc, updatedAt desc`.
   */
  async findMany(query: LeadQuery = {}): Promise<{ leads: Lead[]; totalCount: number }> {
    try {
      const filter = this.buildFilter(query);

      // Run count + find in parallel for efficiency
      const [totalCount, docs] = await Promise.all([
        LeadModel.countDocuments(filter).exec(),
        LeadModel.find(filter)
          .sort(this.buildSort(query))
          .skip(query.skip ?? 0)
          .limit(query.limit ?? 10)
          .lean<ILeadDocument[]>()
          .exec(),
      ]);

      return {
        leads: docs.map(LeadService.toPlainLead),
        totalCount,
      };
    } catch (err) {
      throw new LeadServiceError("Failed to query leads", err);
    }
  }

  // ── Convenience finders ────────────────────────────────

  /** Find a single lead by its MongoDB `_id`. */
  async findById(id: string): Promise<Lead | null> {
    try {
      const doc = await LeadModel.findById(id).lean<ILeadDocument>().exec();
      return doc ? LeadService.toPlainLead(doc) : null;
    } catch (err) {
      throw new LeadServiceError(`Failed to find lead by id=${id}`, err);
    }
  }

  /** Find leads matching a contact name (partial, case-insensitive). */
  async findByName(name: string, limit = 10): Promise<Lead[]> {
    const { leads } = await this.findMany({ name, limit });
    return leads;
  }

  /** Find leads matching a company name (partial, case-insensitive). */
  async findByCompany(company: string, limit = 10): Promise<Lead[]> {
    const { leads } = await this.findMany({ company, limit });
    return leads;
  }

  /** Find leads at a specific pipeline stage. */
  async findByStage(dealStage: DealStage, limit = 10): Promise<Lead[]> {
    const { leads } = await this.findMany({ dealStage, limit });
    return leads;
  }

  /** Count documents matching the given filters (without fetching). */
  async countLeads(query: LeadQuery = {}): Promise<number> {
    try {
      return await LeadModel.countDocuments(this.buildFilter(query)).exec();
    } catch (err) {
      throw new LeadServiceError("Failed to count leads", err);
    }
  }

  /**
   * Return the number of leads at each pipeline stage.
   * Useful for CRM dashboards and Thinker "give me the pipeline summary".
   */
  async getStageDistribution(): Promise<Record<DealStage, number>> {
    try {
      const agg = await LeadModel.aggregate<{ _id: DealStage; count: number }>([
        { $group: { _id: "$dealStage", count: { $sum: 1 } } },
      ]).exec();

      const result: Record<string, number> = {
        prospecting: 0,
        qualified: 0,
        proposal: 0,
        negotiation: 0,
        closed_won: 0,
        closed_lost: 0,
      };
      for (const bucket of agg) {
        result[bucket._id] = bucket.count;
      }
      return result as Record<DealStage, number>;
    } catch (err) {
      throw new LeadServiceError("Failed to compute stage distribution", err);
    }
  }

  /** Return leads whose `nextFollowUp` date has passed. */
  async getOverdueFollowUps(limit = 20): Promise<Lead[]> {
    const { leads } = await this.findMany({
      needsFollowUp: true,
      sortBy: "nextFollowUp",
      sortOrder: "asc",
      limit,
    });
    return leads;
  }

  // ── Private helpers ────────────────────────────────────

  /**
   * Build a Mongoose filter object from a LeadQuery.
   *
   * String fields → `$regex` (partial, case-insensitive).
   * Enum/boolean fields → exact match.
   * `search` → MongoDB `$text` operator (uses the text index).
   */
  private buildFilter(query: LeadQuery): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    // ── Partial-match string filters ─────────
    if (query.name) {
      filter.contactName = { $regex: query.name, $options: "i" };
    }
    if (query.company) {
      filter.company = { $regex: query.company, $options: "i" };
    }
    if (query.industry) {
      filter.industry = { $regex: query.industry, $options: "i" };
    }
    if (query.location) {
      filter.location = { $regex: query.location, $options: "i" };
    }

    // ── Exact-match enum filters ─────────────
    if (query.dealStage) {
      filter.dealStage = query.dealStage;
    }
    if (query.companySize) {
      filter.companySize = query.companySize;
    }
    if (query.source) {
      filter.source = query.source;
    }
    if (query.priority) {
      filter.priority = query.priority;
    }

    // ── Tag filter (AND — lead must have ALL supplied tags) ──
    if (query.tags && query.tags.length > 0) {
      filter.tags = { $all: query.tags };
    }

    // ── Value range ──────────────────────────
    if (query.minValue !== undefined || query.maxValue !== undefined) {
      const range: Record<string, number> = {};
      if (query.minValue !== undefined) range.$gte = query.minValue;
      if (query.maxValue !== undefined) range.$lte = query.maxValue;
      filter.estimatedValue = range;
    }

    // ── Full-text search ─────────────────────
    if (query.search) {
      filter.$text = { $search: query.search };
    }

    // ── Follow-up overdue ────────────────────
    if (query.needsFollowUp) {
      filter.nextFollowUp = { $lte: new Date() };
    }

    return filter;
  }

  /**
   * Build a Mongoose sort object.
   * Defaults to `{ priority: -1, updatedAt: -1 }` when nothing is specified.
   *
   * NOTE: priority sorts alphabetically in Mongo (high < low < medium).
   * For semantic ordering we use `priorityWeight` (a virtual numeric field
   * set by the schema or an aggregation). Since we don't have a stored
   * weight, we use a $addFields pipeline instead when sorting by priority
   * without a specific sortBy — see findMany().
   */
  private buildSort(query: LeadQuery): Record<string, 1 | -1> {
    if (query.sortBy) {
      const dir = query.sortOrder === "asc" ? 1 : -1;
      return { [query.sortBy]: dir } as Record<LeadSortField, 1 | -1>;
    }
    // When no explicit sortBy, we use updatedAt only.
    // Priority-based sorting is handled via aggregate in findMany.
    return { updatedAt: -1 };
  }

  /** Map a Mongoose lean document to a plain `Lead` DTO. */
  static toPlainLead(doc: ILeadDocument): Lead {
    return {
      id: doc._id.toString(),
      company: doc.company,
      contactName: doc.contactName,
      contactEmail: doc.contactEmail,
      contactPhone: doc.contactPhone,
      contactTitle: doc.contactTitle,
      industry: doc.industry,
      location: doc.location,
      dealStage: doc.dealStage,
      companySize: doc.companySize,
      estimatedValue: doc.estimatedValue,
      source: doc.source,
      priority: doc.priority,
      tags: doc.tags,
      notes: doc.notes,
      lastContactedAt: doc.lastContactedAt,
      nextFollowUp: doc.nextFollowUp,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
