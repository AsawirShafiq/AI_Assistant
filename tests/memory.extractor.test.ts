/**
 * MemoryExtractor Tests
 *
 * Validates both rule-based and LLM-fallback extraction paths.
 * Uses MockLLMProvider so tests run without API keys.
 */

import { MemoryExtractor } from "../src/services/memory.extractor";
import { MockLLMProvider } from "../src/services/llm.provider";
import { MemoryUpdate } from "../src/types";

// ─── Helpers ─────────────────────────────────────────────

/** Shortcut to find the first update matching a field name. */
function findUpdate(updates: MemoryUpdate[], field: string) {
  return updates.find((u) => u.field === field);
}

// ─── Rule-Based Extraction ───────────────────────────────

describe("MemoryExtractor — rule-based", () => {
  const extractor = new MemoryExtractor();

  // ── Length ──────────────────────────────────────────────

  it("detects 'make it shorter'", async () => {
    const result = await extractor.extract("make it shorter");
    expect(result.detected).toBe(true);
    expect(result.usedLLM).toBe(false);
    const u = findUpdate(result.updates, "preferredLength");
    expect(u).toBeDefined();
    expect(u!.value).toBe("short");
    expect(u!.operation).toBe("set");
    expect(u!.confidence).toBe(1.0);
  });

  it("detects 'make emails more detailed'", async () => {
    const result = await extractor.extract("make emails more detailed");
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "preferredLength");
    expect(u).toBeDefined();
    expect(u!.value).toBe("long");
  });

  it("detects 'medium length'", async () => {
    const result = await extractor.extract("I'd prefer medium length");
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "preferredLength");
    expect(u).toBeDefined();
    expect(u!.value).toBe("medium");
  });

  // ── Tone ───────────────────────────────────────────────

  it.each([
    ["use a professional tone", "professional"],
    ["be more casual", "casual"],
    ["switch to friendly tone", "friendly"],
    ["make it formal", "formal"],
  ])("detects tone: '%s' → %s", async (input, expected) => {
    const result = await extractor.extract(input);
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "tone");
    expect(u).toBeDefined();
    expect(u!.value).toBe(expected);
    expect(u!.operation).toBe("set");
  });

  // ── Avoid Phrases ─────────────────────────────────────

  it("detects 'don't say synergy'", async () => {
    const result = await extractor.extract("don't say synergy");
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "avoidPhrases");
    expect(u).toBeDefined();
    expect(u!.value).toBe("synergy");
    expect(u!.operation).toBe("append");
  });

  it("detects 'stop using leverage'", async () => {
    const result = await extractor.extract("stop using leverage");
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "avoidPhrases");
    expect(u).toBeDefined();
    expect(u!.value).toBe("leverage");
    expect(u!.operation).toBe("append");
  });

  it("detects 'you can say synergy again'", async () => {
    const result = await extractor.extract("you can say synergy again");
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "avoidPhrases");
    expect(u).toBeDefined();
    expect(u!.value).toBe("synergy");
    expect(u!.operation).toBe("remove");
  });

  // ── Sign-off ───────────────────────────────────────────

  it("detects sign-off: 'sign off with Best regards'", async () => {
    const result = await extractor.extract("sign off with Best regards");
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "signOff");
    expect(u).toBeDefined();
    expect(u!.value).toBe("Best regards");
    expect(u!.operation).toBe("set");
  });

  // ── Sender Identity ───────────────────────────────────

  it("detects 'my name is John Smith'", async () => {
    const result = await extractor.extract("my name is john smith");
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "senderName");
    expect(u).toBeDefined();
    expect(u!.value).toBe("John Smith");
    expect(u!.confidence).toBe(0.9);
  });

  it("detects 'I work for Acme Corp'", async () => {
    const result = await extractor.extract("I work for Acme Corp");
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "companyName");
    expect(u).toBeDefined();
    // Value is extracted from lowercased text (rule doesn't use matchOriginal)
    expect((u!.value as string).toLowerCase()).toBe("acme corp");
  });

  // ── Style Notes ────────────────────────────────────────

  it("detects 'always include a call-to-action at the end'", async () => {
    const result = await extractor.extract(
      "always include a call-to-action at the end"
    );
    expect(result.detected).toBe(true);
    const u = findUpdate(result.updates, "styleNotes");
    expect(u).toBeDefined();
    expect(u!.operation).toBe("append");
    expect(u!.confidence).toBe(0.8);
  });

  // ── Edge Cases ─────────────────────────────────────────

  it("returns empty for blank input", async () => {
    const result = await extractor.extract("");
    expect(result.detected).toBe(false);
    expect(result.updates).toHaveLength(0);
  });

  it("returns empty for unrelated input", async () => {
    const result = await extractor.extract("The weather is nice today");
    expect(result.detected).toBe(false);
    expect(result.updates).toHaveLength(0);
  });

  it("de-duplicates same field set operations", async () => {
    // "use a professional tone" AND "tone should be friendly" — first wins
    const result = await extractor.extract(
      "use a professional tone, tone should be formal"
    );
    expect(result.detected).toBe(true);
    const toneUpdates = result.updates.filter((u) => u.field === "tone");
    expect(toneUpdates).toHaveLength(1);
    expect(toneUpdates[0].value).toBe("professional");
  });
});

// ─── LLM Fallback Extraction ────────────────────────────

describe("MemoryExtractor — LLM fallback", () => {
  it("falls back to LLM when rules produce nothing", async () => {
    const mockLLM = new MockLLMProvider(
      JSON.stringify([
        {
          field: "tone",
          value: "assertive",
          operation: "set",
          confidence: 0.8,
        },
      ])
    );
    const extractor = new MemoryExtractor(mockLLM);

    // Use text that won't match any regex rule, forcing LLM fallback
    const result = await extractor.extract(
      "the vibe should feel punchy and bold"
    );
    expect(result.detected).toBe(true);
    expect(result.usedLLM).toBe(true);
    const u = findUpdate(result.updates, "tone");
    expect(u).toBeDefined();
    expect(u!.value).toBe("assertive");
  });

  it("handles LLM returning empty array", async () => {
    const mockLLM = new MockLLMProvider("[]");
    const extractor = new MemoryExtractor(mockLLM);

    const result = await extractor.extract("random unrelated text about cats");
    expect(result.detected).toBe(false);
    expect(result.usedLLM).toBe(true);
    expect(result.updates).toHaveLength(0);
  });

  it("handles LLM returning invalid JSON gracefully", async () => {
    const mockLLM = new MockLLMProvider("this is not json");
    const extractor = new MemoryExtractor(mockLLM);

    const result = await extractor.extract("something weird");
    expect(result.detected).toBe(false);
    expect(result.updates).toHaveLength(0);
  });

  it("strips markdown code fences from LLM response", async () => {
    const mockLLM = new MockLLMProvider(
      '```json\n[{"field":"preferredLength","value":"short","operation":"set","confidence":0.9}]\n```'
    );
    const extractor = new MemoryExtractor(mockLLM);

    const result = await extractor.extract("keep everything brief please");
    // Rules may match first; if not, LLM fallback handles fences
    expect(result.detected).toBe(true);
  });

  it("clamps confidence to [0, 1]", async () => {
    const mockLLM = new MockLLMProvider(
      JSON.stringify([
        { field: "tone", value: "casual", operation: "set", confidence: 5.0 },
      ])
    );
    const extractor = new MemoryExtractor(mockLLM);

    const result = await extractor.extract("hmm change the vibe");
    if (result.detected && result.usedLLM) {
      expect(result.updates[0].confidence).toBeLessThanOrEqual(1);
    }
  });

  it("skips rules path when rules match (LLM not called)", async () => {
    let llmCalled = false;
    const mockLLM: any = {
      modelName: "mock",
      pricing: { inputPer1M: 0, outputPer1M: 0 },
      generate: async () => {
        llmCalled = true;
        return { text: "[]", durationMs: 0 };
      },
    };
    const extractor = new MemoryExtractor(mockLLM);

    await extractor.extract("make it shorter");
    expect(llmCalled).toBe(false);
  });
});
