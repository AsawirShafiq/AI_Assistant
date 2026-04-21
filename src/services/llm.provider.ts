/**
 * LLM Provider Abstraction
 *
 * Defines a provider-agnostic interface for text generation so the
 * WriterAgent / EmailService never import a specific SDK directly.
 *
 * ## Why an abstraction?
 *
 * 1. **Swap providers** — switch between OpenAI, Claude, Gemini, or a
 *    local model by implementing `ILLMProvider` without touching agent code.
 * 2. **Testing** — inject a `MockLLMProvider` that returns deterministic
 *    strings. No API keys needed in CI.
 * 3. **Rate-limit / retry** — centralised in the provider, not scattered
 *    across every agent.
 */

// ─── Interface ───────────────────────────────────────────

export interface LLMGenerateOptions {
  /** System-level instruction (role prompt). */
  systemPrompt: string;
  /** The user-turn content. */
  userPrompt: string;
  /** Optional temperature override (0–2). */
  temperature?: number;
  /** Maximum tokens in the response. */
  maxTokens?: number;
}

export interface LLMGenerateResult {
  /** The generated text. */
  text: string;
  /** Wall-clock ms the generation took. */
  durationMs: number;
  /** Token usage from the API (if available). */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Provider-agnostic LLM interface.
 *
 * Every concrete provider implements this. Agents depend only on this
 * interface, never on a specific SDK.
 */
export interface ILLMProvider {
  /** Human-readable name (e.g. "gpt-4o-mini"). */
  readonly modelName: string;
  /** Generate a text completion. */
  generate(options: LLMGenerateOptions): Promise<LLMGenerateResult>;
  /** Estimated cost per 1M tokens [input, output] for this model. */
  readonly pricing: { inputPer1M: number; outputPer1M: number };
}

// ─── OpenAI Implementation ───────────────────────────────

import OpenAI from "openai";

/** Pricing per 1M tokens for common OpenAI models. */
const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "gpt-4o": { inputPer1M: 2.50, outputPer1M: 10.00 },
  "gpt-4-turbo": { inputPer1M: 10.00, outputPer1M: 30.00 },
  "gpt-3.5-turbo": { inputPer1M: 0.50, outputPer1M: 1.50 },
};

export class OpenAIProvider implements ILLMProvider {
  readonly modelName: string;
  readonly pricing: { inputPer1M: number; outputPer1M: number };
  private client: OpenAI;

  constructor(apiKey: string, model = "gpt-4o-mini") {
    this.client = new OpenAI({ apiKey });
    this.modelName = model;
    this.pricing = MODEL_PRICING[model] ?? { inputPer1M: 0.15, outputPer1M: 0.60 };
  }

  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const start = Date.now();

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1024,
    });

    const text = (response.choices[0]?.message?.content ?? "").trim();
    const apiUsage = response.usage;

    return {
      text,
      durationMs: Date.now() - start,
      usage: apiUsage
        ? {
            promptTokens: apiUsage.prompt_tokens,
            completionTokens: apiUsage.completion_tokens,
            totalTokens: apiUsage.total_tokens,
          }
        : undefined,
    };
  }
}

// ─── Mock (for tests) ────────────────────────────────────

/**
 * Deterministic mock that returns a canned response.
 * Useful for unit tests that shouldn't hit the network.
 */
export class MockLLMProvider implements ILLMProvider {
  readonly modelName = "mock-provider";
  readonly pricing = { inputPer1M: 0, outputPer1M: 0 };

  constructor(private readonly cannedResponse: string = "Subject: Test\n\nHello, this is a test email.") {}

  async generate(_options: LLMGenerateOptions): Promise<LLMGenerateResult> {
    return {
      text: this.cannedResponse,
      durationMs: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}
