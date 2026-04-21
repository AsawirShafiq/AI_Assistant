/**
 * examples/writer-agent-usage.ts
 *
 * Demonstrates the WriterAgent with the MockLLMProvider (no API key needed)
 * and shows what real outputs look like with OpenAI.
 *
 * Run:  npx tsx examples/writer-agent-usage.ts
 *
 * Note: When using MockLLMProvider, no OPENAI_API_KEY is required.
 * Set OPENAI_API_KEY in .env to also run the real-OpenAI example (G).
 */

// We set a dummy key BEFORE any import touches config/env.ts,
// so the example works without a real .env file.
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "DUMMY_KEY_FOR_EXAMPLES";
}

import { WriterAgent } from "../src/agents/writer.agent";
import { MockLLMProvider } from "../src/services/llm.provider";
import { Lead, UserPreferences, EmailRequest } from "../src/types";

// ─── Sample data ─────────────────────────────────────────

const sampleLead: Lead = {
  id: "64a1b2c3d4e5f6a7b8c9d0e1",
  company: "NovaPay",
  contactName: "Sarah Chen",
  contactEmail: "sarah@novapay.io",
  contactPhone: "+1-415-555-0192",
  contactTitle: "VP of Engineering",
  industry: "fintech",
  location: "San Francisco, CA",
  dealStage: "qualified",
  companySize: "mid-market",
  estimatedValue: 120_000,
  source: "linkedin",
  priority: "high",
  tags: ["payments", "api-first", "series-b"],
  notes: "Met at FinTech Summit 2025. Strong pain point around payment reconciliation latency.",
  lastContactedAt: new Date("2026-03-15"),
  nextFollowUp: new Date("2026-04-01"),
  createdAt: new Date("2025-11-01"),
  updatedAt: new Date("2026-03-15"),
};

const samplePreferences: UserPreferences = {
  userId: "user_001",
  tone: "professional",
  signOff: "Best regards",
  senderName: "Alex Rivera",
  senderTitle: "Account Executive",
  companyName: "DataStream AI",
  avoidPhrases: ["touching base", "circle back", "synergy"],
  preferredTemplates: [],
  updatedAt: new Date(),
};

// ─── Mock provider with realistic canned responses ───────

const MOCK_FIRST_OUTREACH = `Subject: Cutting payment reconciliation time at NovaPay

Hi Sarah,

Your talk at the FinTech Summit on NovaPay's real-time settlement engine was impressive — especially the sub-200ms latency you've achieved on the clearing side.

I noticed reconciliation is still a bottleneck for many mid-market payment platforms. At DataStream AI, we've helped companies like Stripe Connect and Adyen reduce reconciliation latency by 60% using event-driven matching pipelines.

Given NovaPay's volume growth after the Series B, I thought this might be timely.

Would a 15-minute call next Tuesday or Wednesday work to explore whether this fits your roadmap?

Best regards,
Alex Rivera
Account Executive, DataStream AI`;

const MOCK_FOLLOW_UP = `Subject: Re: Cutting payment reconciliation time at NovaPay

Hi Sarah,

I wanted to share a quick data point since my last note — our latest case study with a mid-market payments company showed a 73% reduction in manual reconciliation exceptions within the first 90 days.

I know Q2 planning is busy, so I'll keep this short: would a brief 10-minute overview be useful before your next sprint cycle?

Best regards,
Alex Rivera
Account Executive, DataStream AI`;

const MOCK_RE_ENGAGEMENT = `Subject: New reconciliation benchmarks for fintech — thought of NovaPay

Hi Sarah,

It's been a few weeks since we last connected, and I completely understand how priorities shift — especially post-Series B.

I'm reaching out because we just published our 2026 Payment Reconciliation Benchmark Report. It covers how mid-market fintech companies are reducing exception rates by 40-70%, and I thought the NovaPay team would find the data useful regardless of whether we work together.

Happy to send it over, or if you've moved on to other priorities entirely, no worries at all — just let me know and I won't follow up again.

Best regards,
Alex Rivera
Account Executive, DataStream AI`;

// ─── Main ────────────────────────────────────────────────

async function main() {
  console.log("══════════════════════════════════════════════════════════");
  console.log("  WriterAgent — Example Usage (MockLLMProvider)");
  console.log("══════════════════════════════════════════════════════════\n");

  // ── Example A: First Outreach ─────────────────────────
  console.log("─── A. First Outreach ──────────────────────────────────\n");
  {
    const mock = new MockLLMProvider(MOCK_FIRST_OUTREACH);
    const agent = new WriterAgent(mock);

    const result = await agent.execute({
      lead: sampleLead,
      preferences: samplePreferences,
      emailType: "first_outreach",
      customInstructions: "Mention their FinTech Summit talk",
    });

    printDraft(result.draft);
  }

  // ── Example B: Follow-Up ──────────────────────────────
  console.log("\n─── B. Follow-Up ───────────────────────────────────────\n");
  {
    const mock = new MockLLMProvider(MOCK_FOLLOW_UP);
    const agent = new WriterAgent(mock);

    const result = await agent.execute({
      lead: sampleLead,
      preferences: samplePreferences,
      emailType: "follow_up",
      previousSubject: "Cutting payment reconciliation time at NovaPay",
      daysSinceLastContact: 12,
      length: "short",
    });

    printDraft(result.draft);
  }

  // ── Example C: Re-Engagement ──────────────────────────
  console.log("\n─── C. Re-Engagement ───────────────────────────────────\n");
  {
    const mock = new MockLLMProvider(MOCK_RE_ENGAGEMENT);
    const agent = new WriterAgent(mock);

    const result = await agent.execute({
      lead: sampleLead,
      preferences: samplePreferences,
      emailType: "re_engagement",
      daysSinceLastContact: 35,
    });

    printDraft(result.draft);
  }

  // ── Example D: Batch generation ───────────────────────
  console.log("\n─── D. Batch Generation (3 leads) ──────────────────────\n");
  {
    const mock = new MockLLMProvider(MOCK_FIRST_OUTREACH);
    const agent = new WriterAgent(mock);

    const leads: Lead[] = [
      sampleLead,
      { ...sampleLead, id: "2", company: "QuantumLedger", contactName: "Marcus Wei", contactEmail: "marcus@quantumledger.com" },
      { ...sampleLead, id: "3", company: "PayGrid", contactName: "Aisha Patel", contactEmail: "aisha@paygrid.io" },
    ];

    const requests: EmailRequest[] = leads.map((lead) => ({
      lead,
      preferences: samplePreferences,
      emailType: "first_outreach" as const,
    }));

    const batchResult = await agent.executeBatch(requests);
    console.log(`  Success: ${batchResult.successCount}, Failed: ${batchResult.failureCount}`);
    console.log(`  Total generation time: ${batchResult.totalGenerationMs}ms`);
    for (const draft of batchResult.drafts) {
      console.log(`  ✓ ${draft.leadCompany} — Subject: ${draft.subject}`);
    }
  }

  // ── Example E: Convenience methods ────────────────────
  console.log("\n─── E. Convenience Method — writeFirstOutreach() ───────\n");
  {
    const mock = new MockLLMProvider(MOCK_FIRST_OUTREACH);
    const agent = new WriterAgent(mock);

    const draft = await agent.writeFirstOutreach({
      lead: sampleLead,
      preferences: samplePreferences,
    });

    console.log(`  Subject: ${draft.subject}`);
    console.log(`  Template: ${draft.templateUsed}`);
    console.log(`  Generation: ${draft.generationMs}ms`);
  }

  // ── Example F: Capabilities for Thinker ───────────────
  console.log("\n─── F. Agent Capabilities ──────────────────────────────\n");
  {
    const mock = new MockLLMProvider("");
    const agent = new WriterAgent(mock);
    const caps = agent.getCapabilities();

    console.log(`  Agent: ${caps.agentName}`);
    console.log(`  Provider: ${caps.llmProvider}`);
    console.log(`  Email types: ${caps.supportedEmailTypes.join(", ")}`);
    console.log(`  Methods: ${caps.convenienceMethods.join(", ")}`);
    console.log(`  Personalisation inputs:`);
    for (const input of caps.personalisationInputs) {
      console.log(`    • ${input.field} — ${input.description}`);
    }
  }

  // ── Example G: Using with real OpenAI (requires API key)
  console.log("\n─── G. Real OpenAI (requires OPENAI_API_KEY) ───────────\n");
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "DUMMY_KEY_FOR_EXAMPLES") {
    try {
      const agent = new WriterAgent(); // uses OpenAIProvider by default
      const result = await agent.execute({
        lead: sampleLead,
        preferences: samplePreferences,
        emailType: "first_outreach",
      });
      printDraft(result.draft);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠ OpenAI call failed: ${msg}`);
      console.log("  This is likely an API key or quota issue — examples A–F above used MockLLMProvider successfully.\n");
    }
  } else {
    console.log("  Set OPENAI_API_KEY in .env to run this example with real LLM output.\n");
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log("  Done.");
  console.log("══════════════════════════════════════════════════════════");
}

function printDraft(draft: import("../src/types").EmailDraft): void {
  console.log(`  To: ${draft.leadContact} <${draft.leadEmail}> (${draft.leadCompany})`);
  console.log(`  Type: ${draft.emailType} | Template: ${draft.templateUsed} | ${draft.generationMs}ms`);
  console.log(`  Subject: ${draft.subject}`);
  console.log(`  ────────────────────────────────────`);
  console.log(draft.body.split("\n").map(l => `  ${l}`).join("\n"));
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
