/**
 * ThinkerAgent Tests
 *
 * Tests the orchestration layer with fully mocked dependencies.
 * Verifies planning, intent routing, reasoning traces, confidence
 * scoring, cost tracking, and error handling.
 */

import { ThinkerAgent } from "../src/orchestration/thinker.agent";
import { MockLLMProvider } from "../src/services/llm.provider";
import { ThinkingResult, PlannerOutput, Lead, UserPreferences } from "../src/types";

// ─── Mock Sub-Dependencies ──────────────────────────────

/** Default preferences returned by the mock MemoryService. */
const DEFAULT_PREFS: UserPreferences = {
  userId: "test_user",
  tone: "professional",
  preferredLength: "medium",
  signature: "",
  signOff: "Best regards",
  senderName: "Test User",
  senderTitle: "Sales Rep",
  companyName: "TestCo",
  avoidPhrases: [],
  styleNotes: [],
  preferredTemplates: [],
  updatedAt: new Date(),
};

function createMockMemoryService(prefs = DEFAULT_PREFS) {
  return {
    getPreferences: jest.fn().mockResolvedValue(prefs),
    updatePreferences: jest.fn().mockResolvedValue(undefined),
    applyFeedback: jest.fn().mockResolvedValue({
      updates: [],
      detected: false,
      explanation: "No changes",
      usedLLM: false,
    }),
    logInteraction: jest.fn().mockResolvedValue(undefined),
    getRecentInteractions: jest.fn().mockResolvedValue([]),
  };
}

const SAMPLE_LEAD: Lead = {
  id: "abc123",
  company: "HealthSync",
  contactName: "Alice Johnson",
  contactEmail: "alice@healthsync.com",
  industry: "Healthcare",
  location: "Boston",
  dealStage: "qualified",
  companySize: "mid-market",
  estimatedValue: 75000,
  source: "referral",
  priority: "high",
  tags: ["healthtech"],
  notes: "Great prospect",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createMockLeadAgent(leads: Lead[] = [SAMPLE_LEAD]) {
  return {
    name: "lead_agent",
    description: "Retrieves leads",
    execute: jest.fn().mockResolvedValue({
      success: true,
      leads,
      totalCount: leads.length,
      summary: `Found ${leads.length} leads`,
    }),
  };
}

function createMockWriterAgent() {
  return {
    name: "writer_agent",
    description: "Writes emails",
    execute: jest.fn().mockResolvedValue({
      success: true,
      draft: {
        subject: "Let's connect about HealthSync",
        body: "Hi Alice, ...",
        emailType: "first_outreach",
        leadId: "abc123",
        leadCompany: "HealthSync",
        generatedAt: new Date(),
        metadata: {
          tone: "professional",
          wordCount: 100,
          model: "mock-provider",
          durationMs: 0,
        },
      },
    }),
  };
}

// ─── Helper ──────────────────────────────────────────────

/**
 * Build a PlannerOutput JSON string to feed into MockLLMProvider.
 */
function plannerJSON(overrides: Partial<PlannerOutput> = {}): string {
  const plan: PlannerOutput = {
    intent: "fetch_leads",
    steps: ["Find leads matching the query"],
    agentsNeeded: ["lead_agent"],
    entities: { contactName: null, company: null },
    leadQuery: {
      name: null,
      company: null,
      industry: null,
      location: null,
      dealStage: null,
      companySize: null,
      search: null,
      limit: 5,
    },
    emailType: undefined,
    customInstructions: "",
    preferenceUpdate: {
      field: null as unknown as string,
      value: "",
      operation: "set",
      feedbackText: "",
    },
    summarizeTarget: undefined,
    ...overrides,
  };
  return JSON.stringify(plan);
}

// ─── Tests ───────────────────────────────────────────────

describe("ThinkerAgent", () => {
  // ── Basic fetch_leads ──────────────────────────────────

  describe("fetch_leads intent", () => {
    it("processes a lead-fetch request end-to-end", async () => {
      const llm = new MockLLMProvider(
        plannerJSON({
          intent: "fetch_leads",
          steps: ["Search for fintech leads in NYC"],
          agentsNeeded: ["lead_agent"],
          leadQuery: {
            name: null,
            company: null,
            industry: "fintech",
            location: "NYC",
            dealStage: null,
            companySize: null,
            search: null,
            limit: 5,
          },
        })
      );

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      const result = await thinker.process("Show me fintech leads in NYC", "test_user");

      expect(result.success).toBe(true);
      expect(result.plan.intent).toBe("fetch_leads");
      expect(result.reasoningTrace.length).toBeGreaterThanOrEqual(3);
      expect(result.data?.leads).toBeDefined();
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── Reasoning Trace Structure ──────────────────────────

  describe("reasoning trace", () => {
    it("includes step numbers and status fields", async () => {
      const llm = new MockLLMProvider(plannerJSON());

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      const result = await thinker.process("Show leads", "test_user");

      for (const step of result.reasoningTrace) {
        expect(step.step).toBeGreaterThan(0);
        expect(["success", "skipped", "error"]).toContain(step.status);
        expect(step.thought).toBeTruthy();
        expect(step.action).toBeTruthy();
      }
    });

    it("first step is always load_preferences", async () => {
      const llm = new MockLLMProvider(plannerJSON());

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      const result = await thinker.process("Hi", "test_user");

      expect(result.reasoningTrace[0].action).toBe("load_preferences");
      expect(result.reasoningTrace[0].step).toBe(1);
    });

    it("second step is always create_plan", async () => {
      const llm = new MockLLMProvider(plannerJSON());

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      const result = await thinker.process("Hi", "test_user");

      expect(result.reasoningTrace[1].action).toBe("create_plan");
    });
  });

  // ── Confidence Score ───────────────────────────────────

  describe("confidence scoring", () => {
    it("returns a confidence score between 0 and 1", async () => {
      const llm = new MockLLMProvider(plannerJSON());

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      const result = await thinker.process("Show leads", "test_user");

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("degrades confidence for markdown-fenced responses", async () => {
      const fencedJSON = "```json\n" + plannerJSON() + "\n```";
      const llm = new MockLLMProvider(fencedJSON);

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      const result = await thinker.process("Show leads", "test_user");

      // Confidence should be degraded (< 1.0) due to fences
      expect(result.confidence).toBeLessThan(1.0);
    });
  });

  // ── Cost Tracking ──────────────────────────────────────

  describe("cost tracking", () => {
    it("returns usage statistics", async () => {
      const llm = new MockLLMProvider(plannerJSON());

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      const result = await thinker.process("Show leads", "test_user");

      expect(result.usage).toBeDefined();
      expect(result.usage!.totalPromptTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage!.totalCompletionTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage!.totalTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage!.estimatedCost).toBeGreaterThanOrEqual(0);
      expect(result.usage!.llmCalls).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Error Handling ─────────────────────────────────────

  describe("error handling", () => {
    it("returns success=false with error message on catastrophic failure", async () => {
      const llm: any = {
        modelName: "failing-provider",
        pricing: { inputPer1M: 0, outputPer1M: 0 },
        generate: jest.fn().mockRejectedValue(new Error("LLM API down")),
      };

      const failingMemory = {
        ...createMockMemoryService(),
        getPreferences: jest.fn().mockRejectedValue(new Error("LLM API down")),
      };

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: failingMemory as any,
      });

      const result = await thinker.process("Show leads", "test_user");

      expect(result.success).toBe(false);
      expect(result.error).toContain("LLM API down");
      expect(result.confidence).toBe(0);
      expect(result.reasoningTrace.some((s) => s.status === "error")).toBe(true);
    });

    it("does not throw - always returns a ThinkingResult", async () => {
      const llm: any = {
        modelName: "failing",
        pricing: { inputPer1M: 0, outputPer1M: 0 },
        generate: jest.fn().mockRejectedValue(new Error("boom")),
      };

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      // Should NOT throw
      const result = await thinker.process("anything", "test_user");
      expect(result).toBeDefined();
      expect(result.userRequest).toBe("anything");
    });
  });

  // ── Decisions Array ────────────────────────────────────

  describe("decisions tracking", () => {
    it("records non-default preference decisions", async () => {
      const customPrefs = {
        ...DEFAULT_PREFS,
        tone: "casual" as const,
        avoidPhrases: ["synergy"],
      };
      const llm = new MockLLMProvider(plannerJSON());

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService(customPrefs) as any,
      });

      const result = await thinker.process("Show leads", "test_user");

      expect(result.decisions).toBeDefined();
      expect(result.decisions!.some((d) => d.decision.includes("casual"))).toBe(true);
      expect(result.decisions!.some((d) => d.decision.includes("Avoiding"))).toBe(true);
    });

    it("records intent classification decision", async () => {
      const llm = new MockLLMProvider(plannerJSON({ intent: "write_email" }));

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      const result = await thinker.process("Write an email", "test_user");

      expect(
        result.decisions!.some((d) => d.decision.includes("write_email"))
      ).toBe(true);
    });
  });

  // ── General Query (fallback intent) ────────────────────

  describe("general_query intent", () => {
    it("returns help text for unclear requests", async () => {
      const llm = new MockLLMProvider(
        plannerJSON({
          intent: "general_query",
          steps: ["Provide help information"],
          agentsNeeded: [],
        })
      );

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: createMockMemoryService() as any,
      });

      const result = await thinker.process("hello", "test_user");

      expect(result.success).toBe(true);
      expect(result.finalResponse).toBeTruthy();
    });
  });

  // ── Interaction Logging ────────────────────────────────

  describe("interaction logging", () => {
    it("logs the interaction after successful processing", async () => {
      const memoryService = createMockMemoryService();
      const llm = new MockLLMProvider(plannerJSON());

      const thinker = new ThinkerAgent({
        llmProvider: llm,
        leadAgent: createMockLeadAgent() as any,
        writerAgent: createMockWriterAgent() as any,
        memoryService: memoryService as any,
      });

      await thinker.process("Show leads", "test_user");

      expect(memoryService.logInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "test_user",
          request: "Show leads",
          intent: "fetch_leads",
        })
      );
    });
  });
});
