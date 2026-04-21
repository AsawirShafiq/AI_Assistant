import { ILLMProvider } from "./llm.provider";
import { buildPromptPair, getAvailableTemplates } from "./email.prompts";
import {
  EmailRequest,
  EmailDraft,
  EmailType,
} from "../types";

// ─── Concurrency Limiter ─────────────────────────────────

/**
 * Simple concurrency limiter — runs at most `concurrency` async
 * tasks in parallel. Replaces p-limit (which is ESM-only).
 */
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      try {
        const value = await tasks[idx]();
        results[idx] = { status: "fulfilled", value };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => runNext()
  );
  await Promise.all(workers);
  return results;
}

// ─── Error ───────────────────────────────────────────────

/**
 * Domain error for email-generation failures.
 * Carries the original cause for diagnostics.
 */
export class EmailServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "EmailServiceError";
  }
}

// ─── Service ─────────────────────────────────────────────

/**
 * EmailService — generates sales emails via an injected LLM provider.
 *
 * Design principles:
 *  • **Provider-agnostic** — depends on `ILLMProvider`, not a concrete SDK.
 *  • **Single Responsibility** — prompt building is delegated to
 *    `email.prompts.ts`; this service only orchestrates generate → parse.
 *  • **Structured output** — every call returns an `EmailDraft` with
 *    metadata (template used, generation time) for traceability.
 *  • **Error wrapping** — all LLM failures become `EmailServiceError`.
 */
export class EmailService {
  constructor(private readonly llm: ILLMProvider) {}

  // ── Core generation ────────────────────────────────────

  /**
   * Generate a single email draft for one lead.
   *
   * 1. Build system + user prompts via the template engine.
   * 2. Call the LLM provider.
   * 3. Parse `Subject: …` from the first line.
   * 4. Return a structured `EmailDraft`.
   */
  async generateEmail(request: EmailRequest): Promise<EmailDraft> {
    try {
      const promptPair = buildPromptPair(request);

      const { text, durationMs } = await this.llm.generate({
        systemPrompt: promptPair.systemPrompt,
        userPrompt: promptPair.userPrompt,
        temperature: promptPair.temperature,
      });

      return this.parseResponse(text, request, promptPair.templateId, durationMs);
    } catch (err) {
      if (err instanceof EmailServiceError) throw err;
      throw new EmailServiceError(
        `Email generation failed for ${request.lead.company}`,
        err
      );
    }
  }

  /**
   * Generate emails for multiple leads with controlled concurrency.
   *
   * Runs up to `concurrency` LLM calls in parallel (default: 3).
   * Returns all successful drafts plus a summary of any failures
   * so the caller (WriterAgent / Thinker) can decide how to handle them.
   */
  async generateBatch(
    requests: EmailRequest[],
    concurrency = 3
  ): Promise<{
    drafts: EmailDraft[];
    errors: Array<{ leadCompany: string; error: string }>;
  }> {
    const drafts: EmailDraft[] = [];
    const errors: Array<{ leadCompany: string; error: string }> = [];

    const tasks = requests.map(
      (req) => async () => {
        const draft = await this.generateEmail(req);
        return { draft, company: req.lead.company };
      }
    );

    const results = await withConcurrency(tasks, concurrency);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        drafts.push(r.value.draft);
      } else {
        errors.push({
          leadCompany: requests[i].lead.company,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }

    return { drafts, errors };
  }

  // ── Metadata ───────────────────────────────────────────

  /** Return the list of supported email types. */
  getAvailableTypes(): EmailType[] {
    return getAvailableTemplates();
  }

  /** Return the model name of the underlying LLM provider. */
  getProviderName(): string {
    return this.llm.modelName;
  }

  // ── Private ────────────────────────────────────────────

  /**
   * Parse the raw LLM output into a structured `EmailDraft`.
   *
   * Expected format:
   *   Line 1: Subject: <subject>
   *   Line 2+: body
   *
   * If the model fails to produce "Subject:", we fall back to a
   * sensible default rather than crashing.
   */
  private parseResponse(
    raw: string,
    request: EmailRequest,
    templateId: string,
    generationMs: number
  ): EmailDraft {
    const lines = raw.split("\n");
    let subject: string;
    let body: string;

    if (lines[0]?.toLowerCase().startsWith("subject:")) {
      subject = lines[0].replace(/^subject:\s*/i, "").trim();
      body = lines.slice(1).join("\n").trim();
    } else {
      // Fallback — the model didn't follow format
      subject = `Quick note for ${request.lead.contactName} at ${request.lead.company}`;
      body = raw;
    }

    return {
      subject,
      body,
      leadCompany: request.lead.company,
      leadContact: request.lead.contactName,
      leadEmail: request.lead.contactEmail,
      emailType: request.emailType,
      templateUsed: templateId,
      generationMs,
    };
  }
}
