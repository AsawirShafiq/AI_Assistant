import { BaseAgent } from "./base.agent";
import { config } from "../config/env";
import { EmailService, EmailServiceError } from "../services/email.service";
import { OpenAIProvider, ILLMProvider } from "../services/llm.provider";
import {
  EmailRequest,
  EmailDraft,
  EmailType,
  WriterAgentResult,
  WriterBatchResult,
} from "../types";

// ─── WriterAgent ─────────────────────────────────────────

/**
 * WriterAgent — generates personalised sales emails via an LLM.
 *
 * ## Architecture
 *
 * ```
 * WriterAgent  (IAgent adapter — thin)
 *       │
 *       ▼
 * EmailService (prompt building + LLM orchestration)
 *       │
 *       ▼
 * ILLMProvider (OpenAI, Claude, mock — swappable)
 * ```
 *
 * ## Design choices
 *
 * 1. **Provider abstraction** — the agent never imports `openai`
 *    directly. An `ILLMProvider` is injected (default: `OpenAIProvider`).
 *    Swap to Claude or a local model by passing a different provider.
 *
 * 2. **Prompt templates** — live in `email.prompts.ts`. Each email type
 *    (`first_outreach`, `follow_up`, `re_engagement`) has its own system
 *    prompt with role anchoring, structured constraints, and output pinning.
 *    Templates are versioned (`first_outreach_v1`) for A/B test tracking.
 *
 * 3. **Memory-driven personalisation** — `UserPreferences` (tone, sign-off,
 *    avoid-phrases, sender identity) flow into the system prompt so every
 *    generation reflects the user's style. Lead data goes in the user prompt.
 *
 * 4. **Structured results** — `execute()` returns `WriterAgentResult` with
 *    the draft *and* the original request for full traceability in the
 *    Thinker's reasoning trace.
 *
 * 5. **Batch support** — `executeBatch()` processes multiple leads, collects
 *    errors per-lead, and returns aggregate timing. The Thinker can call this
 *    instead of looping `execute()` when writing to multiple leads.
 *
 * 6. **Fail-safe parsing** — if the LLM doesn't produce `Subject: …` on line 1,
 *    we fall back to a sensible default instead of crashing.
 *
 * ## Supported email types
 *
 * | Type             | Use case                                              |
 * |------------------|-------------------------------------------------------|
 * | first_outreach   | Cold email — creative hook, company-specific opener   |
 * | follow_up        | 2nd/3rd touch — shorter, adds new value, references prior email |
 * | re_engagement    | Gone-cold lead — warm/empathetic, new reason to reconnect |
 */
export class WriterAgent extends BaseAgent<EmailRequest, WriterAgentResult> {
  readonly name = "writer_agent";
  readonly description =
    "Generates personalised sales emails (first outreach, follow-up, " +
    "re-engagement) given a lead and user preferences. Supports tone, " +
    "length, and style customisation via user memory.";

  private readonly emailService: EmailService;

  /**
   * @param llmProvider  Optional LLM provider override. Defaults to
   *                     OpenAIProvider using env config.
   * @param emailService Optional EmailService override (for testing).
   */
  constructor(llmProvider?: ILLMProvider, emailService?: EmailService) {
    super();
    const provider = llmProvider ?? new OpenAIProvider(config.openaiApiKey, config.openaiModel);
    this.emailService = emailService ?? new EmailService(provider);
  }

  // ── IAgent contract ────────────────────────────────────

  /**
   * Generate a single email. Called by the ThinkerAgent for each lead.
   *
   * Returns `WriterAgentResult` wrapping the draft and the original request.
   */
  async execute(request: EmailRequest): Promise<WriterAgentResult> {
    try {
      const draft = await this.emailService.generateEmail(request);
      return { draft, request };
    } catch (err) {
      if (err instanceof EmailServiceError) throw err;
      throw new EmailServiceError("WriterAgent.execute failed", err);
    }
  }

  // ── Batch generation ───────────────────────────────────

  /**
   * Generate emails for multiple leads in one call.
   *
   * Errors are collected per-lead so one failure doesn't abort the batch.
   */
  async executeBatch(requests: EmailRequest[]): Promise<WriterBatchResult> {
    const start = Date.now();
    const { drafts, errors } = await this.emailService.generateBatch(requests);

    return {
      drafts,
      totalGenerationMs: Date.now() - start,
      successCount: drafts.length,
      failureCount: errors.length,
      errors,
    };
  }

  // ── Convenience shortcuts ──────────────────────────────

  /**
   * Quick first-outreach email. Useful outside the orchestrator.
   */
  async writeFirstOutreach(request: Omit<EmailRequest, "emailType">): Promise<EmailDraft> {
    const { draft } = await this.execute({ ...request, emailType: "first_outreach" });
    return draft;
  }

  /**
   * Quick follow-up email.
   */
  async writeFollowUp(request: Omit<EmailRequest, "emailType">): Promise<EmailDraft> {
    const { draft } = await this.execute({ ...request, emailType: "follow_up" });
    return draft;
  }

  /**
   * Quick re-engagement email.
   */
  async writeReEngagement(request: Omit<EmailRequest, "emailType">): Promise<EmailDraft> {
    const { draft } = await this.execute({ ...request, emailType: "re_engagement" });
    return draft;
  }

  // ── Thinker integration ────────────────────────────────

  /**
   * Machine-readable capability descriptor.
   * The ThinkerAgent can inject this into its planning prompt.
   */
  getCapabilities(): WriterCapabilities {
    return {
      agentName: this.name,
      description: this.description,
      llmProvider: this.emailService.getProviderName(),
      supportedEmailTypes: this.emailService.getAvailableTypes(),
      personalisationInputs: [
        { field: "preferences.tone",       description: "Email tone (professional, friendly, casual, formal, assertive, consultative)" },
        { field: "preferences.signOff",    description: "Closing sign-off text" },
        { field: "preferences.senderName", description: "Sender's full name" },
        { field: "preferences.senderTitle",description: "Sender's job title" },
        { field: "preferences.companyName",description: "Sender's company" },
        { field: "preferences.avoidPhrases", description: "Phrases the LLM must never use" },
        { field: "lead.*",                 description: "All lead fields are injected into the user prompt for personalisation" },
        { field: "customInstructions",     description: "Free-form extra instructions per request" },
        { field: "length",                 description: "Override email length: short (80w), medium (150w), long (250w)" },
        { field: "previousSubject",        description: "Prior email subject for follow-up / re-engagement threading" },
        { field: "daysSinceLastContact",   description: "Days since last outreach — adjusts urgency and tone" },
      ],
      convenienceMethods: [
        "writeFirstOutreach(request)",
        "writeFollowUp(request)",
        "writeReEngagement(request)",
        "executeBatch(requests)",
      ],
    };
  }
}

// ─── Supporting types ────────────────────────────────────

export interface WriterCapabilities {
  agentName: string;
  description: string;
  llmProvider: string;
  supportedEmailTypes: EmailType[];
  personalisationInputs: Array<{ field: string; description: string }>;
  convenienceMethods: string[];
}

