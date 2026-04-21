import { BaseAgent } from "./base.agent";
import { LeadService, LeadServiceError } from "../services/lead.service";
import { Lead, LeadQuery, LeadAgentResult, DealStage } from "../types";

// ─── LeadAgent ───────────────────────────────────────────

/**
 * LeadAgent — deterministic data agent that retrieves leads from MongoDB.
 *
 * ## Design choices
 *
 * 1. **Service delegation** — all database logic lives in `LeadService`.
 *    The agent is a thin adapter that conforms to the `IAgent<TInput, TOutput>`
 *    contract the ThinkerAgent expects. This means:
 *      • The service is independently unit-testable with no agent overhead.
 *      • Multiple consumers (API routes, CLI, other agents) can reuse the
 *        same service without going through the agent abstraction.
 *
 * 2. **Structured result** — `execute()` returns `LeadAgentResult` containing
 *    `leads`, `totalCount`, `query`, and `durationMs`. This gives the Thinker
 *    agent rich metadata for reasoning without having to parse raw arrays.
 *
 * 3. **Fail-safe defaults** — unknown / malformed queries still return an
 *    empty result instead of crashing. Errors are caught, wrapped, and
 *    re-thrown so the orchestrator can decide how to surface them.
 *
 * 4. **No LLM coupling** — the agent is fully deterministic. Input → query →
 *    database → output. This makes behaviour predictable and testable.
 *
 * ## Supported queries
 *
 * | Filter           | Match type                        |
 * |------------------|-----------------------------------|
 * | `name`           | Partial, case-insensitive regex   |
 * | `company`        | Partial, case-insensitive regex   |
 * | `industry`       | Partial, case-insensitive regex   |
 * | `location`       | Partial, case-insensitive regex   |
 * | `dealStage`      | Exact enum match                  |
 * | `companySize`    | Exact enum match                  |
 * | `source`         | Exact enum match                  |
 * | `priority`       | Exact enum match                  |
 * | `tags`           | AND — lead must have ALL tags     |
 * | `minValue/maxValue` | Numeric range on estimatedValue |
 * | `search`         | MongoDB full-text `$text` search  |
 * | `needsFollowUp`  | nextFollowUp ≤ now                |
 */
export class LeadAgent extends BaseAgent<LeadQuery, LeadAgentResult> {
  readonly name = "lead_agent";
  readonly description =
    "Retrieves sales leads from the database. Supports filtering by name, " +
    "company, industry, location, dealStage, companySize, source, priority, " +
    "tags, value range, and free-text search. Returns structured results " +
    "with total count, timing, and the original query for traceability.";

  private readonly leadService: LeadService;

  constructor(leadService?: LeadService) {
    super();
    // Accept an injected service (for testing) or create a default one.
    this.leadService = leadService ?? new LeadService();
  }

  // ── IAgent contract ────────────────────────────────────

  /**
   * Primary entry point called by the ThinkerAgent.
   *
   * Returns a `LeadAgentResult` wrapping the leads, total count,
   * original query, and wall-clock duration in milliseconds.
   */
  async execute(query: LeadQuery): Promise<LeadAgentResult> {
    const start = Date.now();

    try {
      const { leads, totalCount } = await this.leadService.findMany(query);
      return {
        leads,
        totalCount,
        query,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      // Wrap unexpected errors so the orchestrator gets a uniform shape
      if (err instanceof LeadServiceError) throw err;
      throw new LeadServiceError("LeadAgent.execute failed", err);
    }
  }

  // ── Convenience shortcuts ──────────────────────────────
  // These exist so callers that import LeadAgent directly (outside the
  // orchestrator) can use the more expressive API without constructing
  // query objects manually.

  /** Find leads by contact name (partial match). */
  async findByName(name: string, limit?: number): Promise<Lead[]> {
    return this.leadService.findByName(name, limit);
  }

  /** Find leads by company name (partial match). */
  async findByCompany(company: string, limit?: number): Promise<Lead[]> {
    return this.leadService.findByCompany(company, limit);
  }

  /** Find leads at a specific pipeline stage. */
  async findByStage(stage: DealStage, limit?: number): Promise<Lead[]> {
    return this.leadService.findByStage(stage, limit);
  }

  /** Find a single lead by its MongoDB _id. */
  async findById(id: string): Promise<Lead | null> {
    return this.leadService.findById(id);
  }

  /** Return leads whose follow-up date has passed. */
  async getOverdueFollowUps(limit?: number): Promise<Lead[]> {
    return this.leadService.getOverdueFollowUps(limit);
  }

  /** Pipeline stage distribution for dashboard / summary. */
  async getStageDistribution(): Promise<Record<DealStage, number>> {
    return this.leadService.getStageDistribution();
  }

  // ── Thinker integration helper ─────────────────────────

  /**
   * Returns a machine-readable description of everything this agent can do.
   *
   * The ThinkerAgent can feed this into its planning prompt so it knows
   * exactly which filters exist and what types they accept — no hard-coding
   * filter names in the planner prompt required.
   */
  getCapabilities(): AgentCapabilities {
    return {
      agentName: this.name,
      description: this.description,
      supportedFilters: [
        { field: "name",           type: "string",  matchType: "partial (case-insensitive)", example: "Sarah"                },
        { field: "company",        type: "string",  matchType: "partial (case-insensitive)", example: "Acme"                 },
        { field: "industry",       type: "string",  matchType: "partial (case-insensitive)", example: "fintech"              },
        { field: "location",       type: "string",  matchType: "partial (case-insensitive)", example: "New York"             },
        { field: "dealStage",      type: "enum",    matchType: "exact",                      example: "qualified"            },
        { field: "companySize",    type: "enum",    matchType: "exact",                      example: "enterprise"           },
        { field: "source",         type: "enum",    matchType: "exact",                      example: "referral"             },
        { field: "priority",       type: "enum",    matchType: "exact",                      example: "high"                 },
        { field: "tags",           type: "string[]", matchType: "AND (all tags required)",    example: '["ai", "enterprise"]' },
        { field: "search",         type: "string",  matchType: "full-text ($text index)",     example: "machine learning"     },
        { field: "minValue",       type: "number",  matchType: "range (>=)",                  example: "50000"                },
        { field: "maxValue",       type: "number",  matchType: "range (<=)",                  example: "500000"               },
        { field: "needsFollowUp",  type: "boolean", matchType: "nextFollowUp <= now",         example: "true"                 },
      ],
      pagination: {
        defaultLimit: 10,
        fields: ["limit", "skip"],
      },
      sorting: {
        defaultSort: "priority desc, updatedAt desc",
        sortableFields: [
          "company", "contactName", "priority", "estimatedValue",
          "dealStage", "createdAt", "updatedAt", "nextFollowUp",
        ],
      },
      convenienceMethods: [
        "findByName(name, limit?)",
        "findByCompany(company, limit?)",
        "findByStage(stage, limit?)",
        "findById(id)",
        "getOverdueFollowUps(limit?)",
        "getStageDistribution()",
      ],
    };
  }
}

// ─── Supporting types ────────────────────────────────────

/** Machine-readable capability descriptor (used by the Thinker planner). */
export interface AgentCapabilities {
  agentName: string;
  description: string;
  supportedFilters: FilterDescriptor[];
  pagination: { defaultLimit: number; fields: string[] };
  sorting: { defaultSort: string; sortableFields: string[] };
  convenienceMethods: string[];
}

export interface FilterDescriptor {
  field: string;
  type: string;
  matchType: string;
  example: string;
}

