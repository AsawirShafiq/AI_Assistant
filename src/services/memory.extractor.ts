/**
 * Memory Extractor
 *
 * Analyses user feedback text and extracts structured MemoryUpdate objects
 * that can be applied to UserPreferences by the MemoryService.
 *
 * ## Two-phase extraction strategy
 *
 * 1. **Rule-based** — fast regex / keyword matching catches common patterns
 *    like "make it shorter", "use a friendly tone", "don't say synergy".
 *    These produce updates with confidence = 1.0.
 *
 * 2. **LLM-based** — if rules produce nothing but the text looks like it
 *    contains preference signals, fall back to an LLM call that returns
 *    structured JSON. These produce updates with confidence = 0.6–0.9.
 *
 * The extractor is stateless — it does NOT read or write the database.
 * The MemoryService calls it, then decides whether to apply the updates.
 */

import {
  MemoryUpdate,
  MemoryExtractionResult,
  UpdatableField,
} from "../types";
import { ILLMProvider } from "./llm.provider";

// ─── Rule Definitions ────────────────────────────────────

interface Rule {
  /** Regex to test against the feedback text. */
  pattern: RegExp;
  /**
   * If true, match against the original (case-preserved) text.
   * Default: match against lowercased text.
   */
  matchOriginal?: boolean;
  /** Build one or more MemoryUpdate from the regex match. */
  extract: (match: RegExpMatchArray, raw: string) => MemoryUpdate[];
}

const RULES: Rule[] = [
  // ── Length ──────────────────────────────────────────────
  {
    pattern:
      /\b(?:make\s+(?:it|them|emails?)\s+)?(?:shorter|more\s+concise|more\s+brief|keep\s+(?:it|them)\s+short)\b/,
    extract: (_m, raw) => [
      {
        field: "preferredLength",
        value: "short",
        operation: "set",
        source: raw,
        confidence: 1.0,
      },
    ],
  },
  {
    pattern:
      /\b(?:make\s+(?:it|them|emails?)\s+)?(?:longer|more\s+detailed|more\s+verbose|elaborate\s+more)\b/,
    extract: (_m, raw) => [
      {
        field: "preferredLength",
        value: "long",
        operation: "set",
        source: raw,
        confidence: 1.0,
      },
    ],
  },
  {
    pattern: /\b(?:medium|moderate)\s+length\b/,
    extract: (_m, raw) => [
      {
        field: "preferredLength",
        value: "medium",
        operation: "set",
        source: raw,
        confidence: 1.0,
      },
    ],
  },

  // ── Tone ───────────────────────────────────────────────
  {
    pattern:
      /\b(?:use|switch\s+to|make\s+(?:it|them)|be\s+more)\s+(?:a\s+)?(?:an?\s+)?(professional|friendly|casual|formal|assertive|consultative|direct)\s*(?:tone)?\b/,
    extract: (m, raw) => [
      {
        field: "tone",
        value: m[1].toLowerCase(),
        operation: "set",
        source: raw,
        confidence: 1.0,
      },
    ],
  },
  {
    pattern: /\btone\s*(?:should\s+be|to|=|:)\s*(professional|friendly|casual|formal|assertive|consultative|direct)\b/,
    extract: (m, raw) => [
      {
        field: "tone",
        value: m[1].toLowerCase(),
        operation: "set",
        source: raw,
        confidence: 1.0,
      },
    ],
  },

  // ── Sign-off ───────────────────────────────────────────
  {
    pattern:
      /\b(?:sign\s*off|close|end\s+(?:with|emails?))\s+(?:with\s+)?["']?([A-Za-z][A-Za-z ,.!]{1,40})["']?\s*$/i,
    matchOriginal: true,
    extract: (m, raw) => [
      {
        field: "signOff",
        value: m[1].trim(),
        operation: "set",
        source: raw,
        confidence: 1.0,
      },
    ],
  },
  {
    pattern:
      /\b(?:use|change)\s+(?:the\s+)?(?:sign[\s-]*off|closing)\s+(?:to\s+)?["']?([A-Za-z][A-Za-z ,.!]{1,40})["']?\s*$/i,
    matchOriginal: true,
    extract: (m, raw) => [
      {
        field: "signOff",
        value: m[1].trim(),
        operation: "set",
        source: raw,
        confidence: 1.0,
      },
    ],
  },

  // ── Avoid phrases ──────────────────────────────────────
  {
    pattern:
      /\b(?:don'?t|do\s+not|never|stop|avoid)\s+(?:use|say|write|include|using|saying)\s+["']?(.+?)["']?\s*$/,
    extract: (m, raw) => {
      const phrase = m[1].trim().replace(/[."'!]+$/, "").trim();
      if (!phrase) return [];
      return [
        {
          field: "avoidPhrases",
          value: phrase,
          operation: "append",
          source: raw,
          confidence: 1.0,
        },
      ];
    },
  },

  // ── Allow a previously-banned phrase ───────────────────
  {
    pattern:
      /\b(?:you\s+can|it'?s\s+ok\s+to|allow|start)\s+(?:use|say|using|saying)\s+["']?(.+?)["']?\s*(?:again)?\s*$/,
    extract: (m, raw) => {
      const phrase = m[1].trim().replace(/[."'!]+$/, "").replace(/\s+again\s*$/, "").trim();
      if (!phrase) return [];
      return [
        {
          field: "avoidPhrases",
          value: phrase,
          operation: "remove",
          source: raw,
          confidence: 1.0,
        },
      ];
    },
  },

  // ── Signature ──────────────────────────────────────────
  {
    pattern:
      /\b(?:use|set|change)\s+(?:my\s+)?(?:email\s+)?signature\s+(?:to|as|:)\s*(.+)$/is,
    matchOriginal: true,
    extract: (m, raw) => [
      {
        field: "signature",
        value: m[1].trim().replace(/^["']|["']$/g, ""),
        operation: "set",
        source: raw,
        confidence: 1.0,
      },
    ],
  },

  // ── Style notes (general instructions) ─────────────────
  {
    pattern:
      /\b(?:always|remember\s+to|make\s+sure\s+to|please)\s+(.{10,80})\s*$/,
    extract: (m, raw) => [
      {
        field: "styleNotes",
        value: m[1].trim().replace(/[.!]+$/, ""),
        operation: "append",
        source: raw,
        confidence: 0.8,
      },
    ],
  },

  // ── Sender identity ────────────────────────────────────
  {
    pattern:
      /\b(?:my\s+name\s+is|call\s+me|i'?m)\s+([a-z]+(?:\s+[a-z]+){0,3})\b/,
    extract: (m, raw) => {
      // Capitalise each word for proper name formatting
      const name = m[1]
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return [
        {
          field: "senderName",
          value: name,
          operation: "set",
          source: raw,
          confidence: 0.9,
        },
      ];
    },
  },
  {
    pattern:
      /\b(?:my\s+(?:title|role|position)\s+is|i'?m\s+(?:a|an|the))\s+(.{3,50})\s*$/,
    extract: (m, raw) => [
      {
        field: "senderTitle",
        value: m[1].trim().replace(/[.!]+$/, ""),
        operation: "set",
        source: raw,
        confidence: 0.9,
      },
    ],
  },
  {
    pattern:
      /\b(?:company\s+(?:name\s+)?is|i\s+work\s+(?:at|for))\s+(.{2,60})\s*$/,
    extract: (m, raw) => [
      {
        field: "companyName",
        value: m[1].trim().replace(/[.!]+$/, ""),
        operation: "set",
        source: raw,
        confidence: 0.9,
      },
    ],
  },
];

// ─── LLM Fallback Prompt ─────────────────────────────────

const LLM_SYSTEM_PROMPT = `You are a preference extraction assistant.
Analyse the user's feedback and extract any email preference updates.

Respond with ONLY a JSON array of update objects. Each object has:
- "field": one of "tone", "preferredLength", "signature", "signOff", "senderName", "senderTitle", "companyName", "avoidPhrases", "styleNotes"
- "value": string (the new value)
- "operation": "set" | "append" | "remove"
- "confidence": number 0-1

If no preference update is detected, respond with an empty array: []

Rules:
- "tone" valid values: professional, friendly, casual, formal, assertive, consultative, direct
- "preferredLength" valid values: short, medium, long, detailed
- For "avoidPhrases" and "styleNotes", use "append" to add or "remove" to remove.
- For all other fields, use "set".
- Only extract clear preference signals. Do NOT hallucinate preferences from general conversation.
- confidence: 0.9 for clear signals, 0.7 for moderate confidence, 0.6 for weak signals.`;

// ─── MemoryExtractor ─────────────────────────────────────

export class MemoryExtractor {
  private llmProvider?: ILLMProvider;

  /**
   * @param llmProvider - Optional. If provided, enables LLM fallback
   *   when rules produce no updates. Pass `undefined` for rules-only mode.
   */
  constructor(llmProvider?: ILLMProvider) {
    this.llmProvider = llmProvider;
  }

  /**
   * Extract preference updates from user feedback text.
   *
   * 1. Tries rule-based extraction first (fast, high confidence).
   * 2. Falls back to LLM if rules found nothing and an LLM provider is available.
   */
  async extract(feedback: string): Promise<MemoryExtractionResult> {
    const trimmed = feedback.trim();
    if (!trimmed) {
      return {
        updates: [],
        detected: false,
        explanation: "Empty feedback — nothing to extract.",
        usedLLM: false,
      };
    }

    // Phase 1: Rule-based
    const ruleUpdates = this.applyRules(trimmed);
    if (ruleUpdates.length > 0) {
      return {
        updates: ruleUpdates,
        detected: true,
        explanation: this.describeUpdates(ruleUpdates, "rules"),
        usedLLM: false,
      };
    }

    // Phase 2: LLM fallback
    if (this.llmProvider) {
      try {
        const llmUpdates = await this.extractViaLLM(trimmed);
        if (llmUpdates.length > 0) {
          return {
            updates: llmUpdates,
            detected: true,
            explanation: this.describeUpdates(llmUpdates, "LLM"),
            usedLLM: true,
          };
        }
      } catch (err) {
        // LLM failed — not fatal, just return no updates
        console.warn("[MemoryExtractor] LLM fallback failed:", err);
      }
    }

    return {
      updates: [],
      detected: false,
      explanation: "No preference signals detected in the feedback.",
      usedLLM: !!this.llmProvider,
    };
  }

  // ── Rule engine ────────────────────────────────────────

  private applyRules(feedback: string): MemoryUpdate[] {
    const lower = feedback.toLowerCase();
    const updates: MemoryUpdate[] = [];
    const seenFields = new Set<string>();

    for (const rule of RULES) {
      const textToMatch = rule.matchOriginal ? feedback : lower;
      const match = textToMatch.match(rule.pattern);
      if (match) {
        const extracted = rule.extract(match, feedback);
        for (const u of extracted) {
          // de-duplicate: if we already have a "set" for this field, skip
          const key = `${u.field}:${u.operation}`;
          if (u.operation === "set" && seenFields.has(key)) continue;
          seenFields.add(key);
          updates.push(u);
        }
      }
    }
    return updates;
  }

  // ── LLM extraction ────────────────────────────────────

  private async extractViaLLM(feedback: string): Promise<MemoryUpdate[]> {
    if (!this.llmProvider) return [];

    const result = await this.llmProvider.generate({
      systemPrompt: LLM_SYSTEM_PROMPT,
      userPrompt: `User feedback: "${feedback}"`,
      temperature: 0.1,
      maxTokens: 500,
    });

    return this.parseLLMResponse(result.text, feedback);
  }

  private parseLLMResponse(text: string, source: string): MemoryUpdate[] {
    try {
      // Strip markdown code fences if present
      const cleaned = text
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];

      const VALID_FIELDS: Set<string> = new Set<string>([
        "tone",
        "preferredLength",
        "signature",
        "signOff",
        "senderName",
        "senderTitle",
        "companyName",
        "avoidPhrases",
        "styleNotes",
      ]);
      const VALID_OPS = new Set(["set", "append", "remove"]);

      const updates: MemoryUpdate[] = [];
      for (const item of parsed) {
        if (
          typeof item.field === "string" &&
          VALID_FIELDS.has(item.field) &&
          item.value !== undefined &&
          typeof item.operation === "string" &&
          VALID_OPS.has(item.operation)
        ) {
          updates.push({
            field: item.field as UpdatableField,
            value: item.value,
            operation: item.operation as "set" | "append" | "remove",
            source,
            confidence:
              typeof item.confidence === "number"
                ? Math.min(1, Math.max(0, item.confidence))
                : 0.7,
          });
        }
      }
      return updates;
    } catch {
      return [];
    }
  }

  // ── Human-readable description ─────────────────────────

  private describeUpdates(updates: MemoryUpdate[], via: string): string {
    const parts = updates.map((u) => {
      const op =
        u.operation === "append"
          ? `add "${u.value}" to`
          : u.operation === "remove"
            ? `remove "${u.value}" from`
            : `set`;
      return `${op} ${u.field}${u.operation === "set" ? ` → "${u.value}"` : ""}`;
    });
    return `Extracted via ${via}: ${parts.join("; ")}`;
  }
}
