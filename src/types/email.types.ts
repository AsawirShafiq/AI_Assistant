// ─── Email Types ─────────────────────────────────────────

import { Lead } from "./lead.types";
import { UserPreferences } from "./memory.types";

/** The three email categories the WriterAgent can produce. */
export type EmailType = "first_outreach" | "follow_up" | "re_engagement";

/** Tone presets the prompt system supports. */
export type EmailTone =
  | "professional"
  | "friendly"
  | "casual"
  | "formal"
  | "assertive"
  | "consultative";

/** Length guidance passed to the LLM. */
export type EmailLength = "short" | "medium" | "long";

/**
 * Full input contract for the WriterAgent / EmailService.
 *
 * The Thinker constructs this from user preferences + lead data
 * and feeds it to `WriterAgent.execute()`.
 */
export interface EmailRequest {
  /** The target lead — all personalisation comes from here. */
  lead: Lead;
  /** User preferences — tone, sign-off, avoid-phrases, etc. */
  preferences: UserPreferences;
  /** Which category of email to generate. */
  emailType: EmailType;
  /** Free-form extra instructions (e.g. "mention our AI product"). */
  customInstructions?: string;
  /** Override the default length for this request only. */
  length?: EmailLength;
  /** Previous subject line to reference (follow-up / re-engagement). */
  previousSubject?: string;
  /** How many days since last contact — injected by the orchestrator. */
  daysSinceLastContact?: number;
}

/** A single generated email ready for review / sending. */
export interface EmailDraft {
  subject: string;
  body: string;
  leadCompany: string;
  leadContact: string;
  leadEmail: string;
  emailType: EmailType;
  /** Which prompt template was used (for debugging / A-B tests). */
  templateUsed: string;
  /** LLM generation time in ms. */
  generationMs: number;
}

/** Structured output returned by `WriterAgent.execute()`. */
export interface WriterAgentResult {
  /** The generated draft. */
  draft: EmailDraft;
  /** The original request (for traceability). */
  request: EmailRequest;
}

/**
 * Batch result returned by `WriterAgent.executeBatch()`.
 * Contains one draft per lead, plus aggregate timing.
 */
export interface WriterBatchResult {
  drafts: EmailDraft[];
  totalGenerationMs: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ leadCompany: string; error: string }>;
}

