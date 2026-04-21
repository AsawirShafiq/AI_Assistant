/**
 * examples/thinker-agent-usage.ts
 *
 * Demonstrates the ThinkerAgent — the core orchestrator.
 *
 * This file shows 4 scenarios that exercise every intent:
 *
 *   A. write_email       — "Write a follow-up email for Sarah Chen from FinFlow"
 *   B. fetch_and_email   — "Find leads in fintech and send them an intro email"
 *   C. summarize         — "Summarise my last conversation with Sarah"
 *   D. update_preferences— "Update my preference to use a formal tone in emails"
 *   E. fetch_leads       — "Show me all cybersecurity leads"
 *   F. general_query     — "What can you do?"
 *   G. Real OpenAI       — Full end-to-end with real LLM (requires OPENAI_API_KEY + MongoDB)
 *
 * A–F use a SmartMockLLMProvider that returns predetermined plans
 * and canned email bodies so no API keys or MongoDB are needed.
 *
 * Run:  npx tsx examples/thinker-agent-usage.ts
 */

// ─── Dummy key guard (same pattern as writer-agent-usage.ts) ─

if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "DUMMY_KEY_FOR_EXAMPLES";
}

import {
  ILLMProvider,
  LLMGenerateOptions,
  LLMGenerateResult,
} from "../src/services/llm.provider";
import {
  PlannerOutput,
  ThinkingResult,
  ReasoningStep,
  Lead,
  UserPreferences,
  LeadQuery,
  LeadAgentResult,
  EmailRequest,
  WriterAgentResult,
  EmailDraft,
  InteractionLog,
} from "../src/types";
import { ThinkerAgent, ThinkerAgentOptions } from "../src/orchestration";
import { LeadAgent } from "../src/agents/lead.agent";
import { WriterAgent } from "../src/agents/writer.agent";
import { MemoryService } from "../src/services/memory.service";
import { LeadService } from "../src/services/lead.service";

// ══════════════════════════════════════════════════════════
// Mock infrastructure — no MongoDB, no API keys needed
// ══════════════════════════════════════════════════════════

// ─── Fake leads (mirrors seed data) ─────────────────────

const MOCK_LEADS: Lead[] = [
  {
    id: "aaa111",
    company: "FinFlow Inc.",
    contactName: "Sarah Chen",
    contactEmail: "sarah.chen@finflow.io",
    contactTitle: "VP of Engineering",
    industry: "fintech",
    location: "New York, NY",
    dealStage: "prospecting",
    companySize: "startup",
    estimatedValue: 35_000,
    source: "linkedin",
    priority: "high",
    tags: ["payments", "series-a", "fast-growth"],
    notes: "Series A startup building payments infrastructure.",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "bbb222",
    company: "PayBridge",
    contactName: "Marcus Williams",
    contactEmail: "m.williams@paybridge.com",
    contactTitle: "CTO",
    industry: "fintech",
    location: "New York, NY",
    dealStage: "qualified",
    companySize: "mid-market",
    estimatedValue: 85_000,
    source: "referral",
    priority: "high",
    tags: ["fraud-detection", "compliance"],
    notes: "Looking for fraud detection solutions.",
    lastContactedAt: new Date(Date.now() - 14 * 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "ccc333",
    company: "NeoBank Labs",
    contactName: "Priya Patel",
    contactEmail: "priya@neobanklabs.com",
    contactTitle: "CEO & Co-founder",
    industry: "fintech",
    location: "San Francisco, CA",
    dealStage: "prospecting",
    companySize: "startup",
    estimatedValue: 20_000,
    source: "conference",
    priority: "medium",
    tags: ["digital-banking", "yc-batch"],
    notes: "Digital banking platform, backed by Y Combinator.",
    lastContactedAt: new Date(Date.now() - 30 * 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "ddd444",
    company: "VaultShield",
    contactName: "Natasha Ivanova",
    contactEmail: "n.ivanova@vaultshield.com",
    contactTitle: "CISO",
    industry: "cybersecurity",
    location: "Washington, DC",
    dealStage: "qualified",
    companySize: "enterprise",
    estimatedValue: 300_000,
    source: "partner",
    priority: "high",
    tags: ["zero-trust", "government", "compliance"],
    notes: "Zero-trust security platform. Government contracts.",
    lastContactedAt: new Date(Date.now() - 4 * 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "eee555",
    company: "CipherLayer",
    contactName: "Alex Pham",
    contactEmail: "alex@cipherlayer.io",
    contactTitle: "VP of Engineering",
    industry: "cybersecurity",
    location: "San Francisco, CA",
    dealStage: "prospecting",
    companySize: "startup",
    estimatedValue: 28_000,
    source: "linkedin",
    priority: "medium",
    tags: ["encryption", "api-security"],
    notes: "API security startup. Seed stage.",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// ─── Mock LeadAgent ─────────────────────────────────────

class MockLeadAgent extends LeadAgent {
  async execute(query: LeadQuery): Promise<LeadAgentResult> {
    const start = Date.now();
    let filtered = [...MOCK_LEADS];

    if (query.name) {
      const re = new RegExp(query.name, "i");
      filtered = filtered.filter((l) => re.test(l.contactName));
    }
    if (query.company) {
      const re = new RegExp(query.company, "i");
      filtered = filtered.filter((l) => re.test(l.company));
    }
    if (query.industry) {
      const re = new RegExp(query.industry, "i");
      filtered = filtered.filter((l) => re.test(l.industry));
    }
    if (query.location) {
      const re = new RegExp(query.location, "i");
      filtered = filtered.filter((l) => re.test(l.location));
    }
    if (query.dealStage) {
      filtered = filtered.filter((l) => l.dealStage === query.dealStage);
    }
    if (query.companySize) {
      filtered = filtered.filter((l) => l.companySize === query.companySize);
    }

    const totalCount = filtered.length;
    const limit = query.limit ?? 5;
    filtered = filtered.slice(0, limit);

    return {
      leads: filtered,
      totalCount,
      query,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Mock WriterAgent ───────────────────────────────────

class MockWriterAgent extends WriterAgent {
  constructor() {
    // Pass a mock LLM that won't be used — we override execute()
    super({
      modelName: "mock-writer",
      async generate() {
        return { text: "", durationMs: 0 };
      },
    });
  }

  async execute(request: EmailRequest): Promise<WriterAgentResult> {
    const lead = request.lead;
    const type = request.emailType;

    const subjects: Record<string, string> = {
      first_outreach: `Solving ${lead.industry} challenges at ${lead.company}`,
      follow_up: `Re: Solving ${lead.industry} challenges at ${lead.company}`,
      re_engagement: `New ${lead.industry} insights — thought of ${lead.company}`,
    };

    const bodies: Record<string, string> = {
      first_outreach:
        `Hi ${lead.contactName.split(" ")[0]},\n\n` +
        `I noticed ${lead.company}'s impressive work in ${lead.industry}. ` +
        `At TechSolutions Corp, we've helped similar companies reduce operational ` +
        `overhead by 40% using our AI-powered platform.\n\n` +
        `Would a 15-minute call next week work to explore if this fits your roadmap?\n\n` +
        `Best regards,\nAlex Morgan\nAccount Executive, TechSolutions Corp`,
      follow_up:
        `Hi ${lead.contactName.split(" ")[0]},\n\n` +
        `I wanted to follow up on my previous note. We just published a ` +
        `case study showing a 65% efficiency gain for a ${lead.industry} company ` +
        `similar to ${lead.company}.\n\n` +
        `Would a brief 10-minute overview be useful?\n\n` +
        `Best regards,\nAlex Morgan\nAccount Executive, TechSolutions Corp`,
      re_engagement:
        `Hi ${lead.contactName.split(" ")[0]},\n\n` +
        `It's been a while since we last connected, and I completely understand ` +
        `how priorities shift.\n\n` +
        `I'm reaching out because we just released new ${lead.industry} benchmarks ` +
        `that I thought the ${lead.company} team would find valuable.\n\n` +
        `Happy to send it over — no strings attached.\n\n` +
        `Best regards,\nAlex Morgan\nAccount Executive, TechSolutions Corp`,
    };

    const draft: EmailDraft = {
      subject: subjects[type] ?? subjects.first_outreach,
      body: bodies[type] ?? bodies.first_outreach,
      leadCompany: lead.company,
      leadContact: lead.contactName,
      leadEmail: lead.contactEmail,
      emailType: type,
      templateUsed: `${type}_v1`,
      generationMs: 0,
    };

    return { draft, request };
  }
}

// ─── Mock MemoryService ─────────────────────────────────

class MockMemoryService extends MemoryService {
  private prefs: UserPreferences = {
    userId: "default_user",
    tone: "professional",
    signOff: "Best regards",
    senderName: "Alex Morgan",
    senderTitle: "Account Executive",
    companyName: "TechSolutions Corp",
    avoidPhrases: ["touching base", "circle back", "synergy"],
    preferredTemplates: [],
    updatedAt: new Date(),
  };

  private interactions: InteractionLog[] = [
    {
      userId: "default_user",
      request: "Find fintech leads in New York",
      intent: "fetch_leads",
      agentsUsed: ["lead_agent"],
      outcomeSummary: "3 leads, 0 emails",
      timestamp: new Date(Date.now() - 2 * 86400000),
    },
    {
      userId: "default_user",
      request: "Write a first outreach email for Sarah Chen at FinFlow",
      intent: "write_email",
      agentsUsed: ["lead_agent", "writer_agent"],
      outcomeSummary: "1 leads, 1 emails",
      timestamp: new Date(Date.now() - 1 * 86400000),
    },
  ];

  async getPreferences(_userId: string): Promise<UserPreferences> {
    return { ...this.prefs };
  }

  async updatePreferences(prefs: UserPreferences): Promise<void> {
    this.prefs = { ...prefs };
  }

  async logInteraction(log: InteractionLog): Promise<void> {
    this.interactions.push(log);
  }

  async getRecentInteractions(
    _userId: string,
    limit = 10
  ): Promise<InteractionLog[]> {
    return this.interactions.slice(-limit);
  }
}

// ─── Smart Mock LLM Provider ────────────────────────────
//
// Returns appropriate JSON plans based on the user's prompt content,
// and canned summaries for summarisation calls. This lets us demo
// the full orchestration flow without any API keys.

class SmartMockLLMProvider implements ILLMProvider {
  readonly modelName = "smart-mock";

  async generate(opts: LLMGenerateOptions): Promise<LLMGenerateResult> {
    // Planning call — system prompt contains "Thinker"
    if (opts.systemPrompt.includes("Thinker")) {
      return { text: this.mockPlan(opts.userPrompt), durationMs: 12 };
    }

    // Summarisation call — system prompt contains "summariser"
    if (opts.systemPrompt.includes("summariser")) {
      return { text: this.mockSummary(opts.userPrompt), durationMs: 8 };
    }

    // Fallback (shouldn't reach here in mock flow)
    return { text: "Subject: Mock\n\nMock email body.", durationMs: 0 };
  }

  private mockPlan(userPrompt: string): string {
    const lower = userPrompt.toLowerCase();

    // Scenario A: write_email — "follow-up email for Sarah Chen from FinFlow"
    if (
      (lower.includes("follow-up") || lower.includes("follow up")) &&
      lower.includes("sarah")
    ) {
      return JSON.stringify({
        intent: "write_email",
        steps: [
          "Detect intent: email generation (follow-up)",
          "Extract entity: Sarah Chen at FinFlow Inc.",
          "Call LeadAgent to find Sarah Chen at FinFlow",
          "Call WriterAgent to generate follow-up email",
          "Return generated email",
        ],
        agentsNeeded: ["lead_agent", "writer_agent"],
        entities: { contactName: "Sarah Chen", company: "FinFlow" },
        leadQuery: {
          name: "Sarah Chen",
          company: "FinFlow",
          limit: 1,
        },
        emailType: "follow_up",
        customInstructions: "",
      });
    }

    // Scenario B: fetch_and_email — "Find leads in fintech and send them an intro email"
    if (lower.includes("fintech") && lower.includes("email")) {
      return JSON.stringify({
        intent: "fetch_and_email",
        steps: [
          "Detect intent: lead search + email generation",
          "Identify filters: industry = fintech",
          "Call LeadAgent to find fintech leads",
          "For each lead, call WriterAgent to generate first_outreach email",
          "Aggregate and return all emails",
        ],
        agentsNeeded: ["lead_agent", "writer_agent"],
        entities: {},
        leadQuery: { industry: "fintech", limit: 5 },
        emailType: "first_outreach",
        customInstructions: "",
      });
    }

    // Scenario C: summarize — "Summarise my last conversation with Sarah"
    if (lower.includes("summar") && lower.includes("sarah")) {
      return JSON.stringify({
        intent: "summarize",
        steps: [
          "Detect intent: summarisation",
          "Extract entity: Sarah",
          "Retrieve interaction history from memory",
          "Summarise interactions related to Sarah via LLM",
          "Return summary",
        ],
        agentsNeeded: [],
        entities: { contactName: "Sarah" },
        summarizeTarget: "Sarah",
      });
    }

    // Scenario D: update_preferences — "Update my preference to use a formal tone"
    if (lower.includes("tone") && lower.includes("formal")) {
      return JSON.stringify({
        intent: "update_preferences",
        steps: [
          "Detect intent: preference update",
          'Extract preference: tone → "formal"',
          "Call MemoryService to update preference",
          "Confirm update to user",
        ],
        agentsNeeded: [],
        entities: {},
        preferenceUpdate: { field: "tone", value: "formal" },
      });
    }

    // Scenario E: fetch_leads — "Show me all cybersecurity leads"
    if (lower.includes("cybersecurity") && !lower.includes("email")) {
      return JSON.stringify({
        intent: "fetch_leads",
        steps: [
          "Detect intent: lead search",
          "Identify filters: industry = cybersecurity",
          "Call LeadAgent to find cybersecurity leads",
          "Return lead list",
        ],
        agentsNeeded: ["lead_agent"],
        entities: {},
        leadQuery: { industry: "cybersecurity", limit: 5 },
      });
    }

    // Scenario F: general_query — fallback
    return JSON.stringify({
      intent: "general_query",
      steps: [
        "Request does not map to a specific action",
        "Provide guidance on available capabilities",
      ],
      agentsNeeded: [],
      entities: {},
    });
  }

  private mockSummary(_userPrompt: string): string {
    return (
      "Here is a summary of your recent interactions related to Sarah:\n\n" +
      "• **2 days ago** — You searched for fintech leads in New York. " +
      "The system found 3 matching leads including Sarah Chen at FinFlow Inc.\n\n" +
      "• **Yesterday** — You requested a first outreach email for Sarah Chen at FinFlow. " +
      "The WriterAgent generated a personalised cold email highlighting " +
      "FinFlow's payments infrastructure.\n\n" +
      "**Key takeaway:** Sarah Chen at FinFlow Inc. is in the prospecting stage " +
      "with an estimated deal value of $35,000. A follow-up email is recommended."
    );
  }
}

// ══════════════════════════════════════════════════════════
// Example runner
// ══════════════════════════════════════════════════════════

function printHeader(label: string): void {
  console.log(`\n─── ${label} ${"─".repeat(Math.max(0, 48 - label.length))}\n`);
}

function printTrace(result: ThinkingResult): void {
  // Plan
  const statusLabel = result.success ? "SUCCESS" : "FAILED";
  const totalMs = `${result.totalDurationMs}ms`;
  console.log(`  ┌─ PLAN [${statusLabel} | ${totalMs}]`);
  console.log(`  │  Intent:  ${result.plan.intent}`);
  console.log(
    `  │  Agents:  [${result.plan.agentsNeeded.join(", ") || "none"}]`
  );
  for (const s of result.plan.steps) {
    console.log(`  │  → ${s}`);
  }

  // Reasoning trace
  console.log(`  │`);
  console.log(`  ├─ REASONING TRACE`);
  const icons: Record<string, string> = {
    success: "✓",
    skipped: "⊘",
    error: "✗",
  };
  for (const step of result.reasoningTrace) {
    const icon = icons[step.status] ?? "?";
    const agent = step.agent ? ` [${step.agent}]` : "";
    const dur = step.durationMs !== undefined ? ` (${step.durationMs}ms)` : "";
    console.log(
      `  │  ${icon} Step ${step.step}${agent}: ${step.action} — ${step.status.toUpperCase()}${dur}`
    );
    console.log(`  │     Thought: ${step.thought}`);
    console.log(`  │     Result:  ${step.resultSummary}`);
  }

  // Response
  console.log(`  │`);
  console.log(`  └─ RESPONSE`);
  const lines = result.finalResponse.split("\n");
  for (const line of lines) {
    console.log(`     ${line}`);
  }
  console.log();
}

async function main(): Promise<void> {
  console.log("══════════════════════════════════════════════════════════");
  console.log("  ThinkerAgent — Example Usage (SmartMockLLMProvider)");
  console.log("══════════════════════════════════════════════════════════");

  // Build the mock-based ThinkerAgent
  const mockLLM = new SmartMockLLMProvider();
  const mockMemory = new MockMemoryService();
  const mockLeadAgent = new MockLeadAgent();
  const mockWriterAgent = new MockWriterAgent();

  const thinker = new ThinkerAgent({
    llmProvider: mockLLM,
    leadAgent: mockLeadAgent,
    writerAgent: mockWriterAgent,
    memoryService: mockMemory,
  });

  // ─── A. write_email: "Write a follow-up email for Sarah Chen from FinFlow"
  printHeader("A. write_email — specific lead + email");
  const resultA = await thinker.process(
    "Write a follow-up email for Sarah Chen from FinFlow"
  );
  printTrace(resultA);

  // ─── B. fetch_and_email: "Find leads in fintech and send them an intro email"
  printHeader("B. fetch_and_email — filter + batch emails");
  const resultB = await thinker.process(
    "Find leads in fintech and send them an intro email"
  );
  printTrace(resultB);

  // ─── C. summarize: "Summarise my last conversation with Sarah"
  printHeader("C. summarize — interaction history");
  const resultC = await thinker.process(
    "Summarise my last conversation with Sarah"
  );
  printTrace(resultC);

  // ─── D. update_preferences: "Update my preference to use a formal tone"
  printHeader("D. update_preferences — memory mutation");
  const resultD = await thinker.process(
    "Update my preference to use a formal tone in emails"
  );
  printTrace(resultD);

  // ─── E. fetch_leads: "Show me all cybersecurity leads"
  printHeader("E. fetch_leads — query only");
  const resultE = await thinker.process("Show me all cybersecurity leads");
  printTrace(resultE);

  // ─── F. general_query: "What can you do?"
  printHeader("F. general_query — fallback help");
  const resultF = await thinker.process("What can you do?");
  printTrace(resultF);

  // ─── G. Real OpenAI + MongoDB ─────────────────────────
  printHeader("G. Real OpenAI + MongoDB (requires OPENAI_API_KEY + MongoDB)");

  if (
    !process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY === "DUMMY_KEY_FOR_EXAMPLES"
  ) {
    console.log(
      "  ⊘ Skipped — set OPENAI_API_KEY in .env and ensure MongoDB is running.\n"
    );
  } else {
    try {
      // Dynamic import to avoid triggering DB connection when not needed
      const { connectDB, closeDB } = await import("../src/database");
      await connectDB();

      const realThinker = new ThinkerAgent();
      const result = await realThinker.process(
        "Write a follow-up email for Sarah Chen from FinFlow"
      );
      printTrace(result);

      await closeDB();
    } catch (err) {
      console.log(
        `  ✗ OpenAI/DB call failed: ${(err as Error).message}\n`
      );
    }
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log("  Done.");
  console.log("══════════════════════════════════════════════════════════");
}

main().catch(console.error);
