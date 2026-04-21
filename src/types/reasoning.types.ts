// ─── Reasoning / Orchestration Types ─────────────────────

import { DealStage, CompanySize } from "./lead.types";

/** Status of each step in the reasoning trace. */
export type StepStatus = "success" | "skipped" | "error";

/**
 * One atomic step in the ThinkerAgent's reasoning trace.
 *
 * Every decision — LLM planning, agent call, preference update, error
 * recovery — is captured as a ReasoningStep so the full execution is
 * explicit and auditable.
 */
export interface ReasoningStep {
  step: number;
  thought: string;
  action: string;
  agent: string | null;
  inputSummary: string;
  resultSummary: string;
  status: StepStatus;
  durationMs?: number;
  timestamp: Date;
}

export interface ExecutionPlan {
  intent: Intent;
  steps: string[];
  agentsNeeded: string[];
}

export type Intent =
  | "fetch_leads"
  | "write_email"
  | "fetch_and_email"
  | "schedule_meeting"
  | "list_meetings"
  | "delete_meeting"
  | "update_preferences"
  | "summarize"
  | "general_query";

/**
 * Structured output the LLM planner produces.
 *
 * Includes entity extraction, lead query filters, email type,
 * preference updates, and summarisation targets — everything the
 * execution pipeline needs to route and chain agents correctly.
 */
export interface PlannerOutput {
  intent: Intent;
  steps: string[];
  agentsNeeded: string[];
  /** Entities extracted from the user's natural-language request. */
  entities: {
    contactName?: string | null;
    company?: string | null;
  };
  /** Query filters for the LeadAgent (only when lead_agent is needed). */
  leadQuery?: {
    name?: string | null;
    company?: string | null;
    industry?: string | null;
    location?: string | null;
    dealStage?: DealStage | null;
    companySize?: CompanySize | null;
    search?: string | null;
    limit?: number;
  };
  /** Email type for the WriterAgent (only when writer_agent is needed). */
  emailType?: string;
  /** Free-form extra instructions for email generation. */
  customInstructions?: string;
  /** Meeting creation payload (only for schedule_meeting intent). */
  meetingInput?: {
    title?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    leadId?: string | null;
  };
  /** Meeting listing/deletion query context. */
  meetingQuery?: {
    meetingId?: string | null;
    title?: string | null;
    leadId?: string | null;
    company?: string | null;
    contactName?: string | null;
    from?: string | null;
    to?: string | null;
    limit?: number;
  };
  /** Preference mutation (only for update_preferences intent). */
  preferenceUpdate?: {
    field: string;
    value: string;
    /** Operation type: "set" (default), "append", or "remove". */
    operation?: string;
    /**
     * Raw user feedback text for implicit preference changes.
     * When present, the MemoryExtractor is used instead of direct field assignment.
     */
    feedbackText?: string;
  };
  /** Entity name to focus a summarisation on (only for summarize intent). */
  summarizeTarget?: string;
}

/**
 * Full result returned by `ThinkerAgent.process()`.
 *
 * Contains the execution plan, every reasoning step, the final
 * user-facing response, structured data payloads, and timing.
 */
export interface ThinkingResult {
  userRequest: string;
  plan: ExecutionPlan;
  reasoningTrace: ReasoningStep[];
  finalResponse: string;
  /** Whether the overall orchestration succeeded. */
  success: boolean;
  /** Error message if success === false. */
  error?: string;
  data?: {
    leads?: Record<string, unknown>[];
    emails?: Record<string, unknown>[];
    meetings?: Record<string, unknown>[];
    preferences?: Record<string, unknown>;
  };
  /**
   * Confidence score (0.0–1.0) indicating how reliable this result is.
   * Derived from: JSON parse success, intent match, filter validity.
   */
  confidence: number;
  /** Raw JSON plan from the LLM planner (for debugging/transparency). */
  rawPlan?: PlannerOutput;
  /**
   * Key decisions the orchestrator made during execution,
   * showing what was personalised and why.
   */
  decisions?: Array<{
    decision: string;
    reason: string;
    source: "memory" | "default" | "user_request" | "llm";
  }>;
  /**
   * Token usage and estimated cost for all LLM calls in this request.
   */
  usage?: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    estimatedCost: number;
    llmCalls: number;
  };
  /** Wall-clock ms for the entire process() call. */
  totalDurationMs: number;
  timestamp: Date;
}
