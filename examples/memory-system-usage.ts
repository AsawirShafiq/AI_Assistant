/**
 * examples/memory-system-usage.ts
 *
 * Demonstrates the User Memory system end-to-end:
 *
 *   A. MemoryExtractor — rule-based extraction (no LLM)
 *   B. MemoryExtractor — LLM-based fallback
 *   C. MemoryService — applyFeedback + preference evolution
 *   D. MemoryService — snapshot with feedback history
 *   E. WriterAgent integration — preferences flow into prompts
 *   F. Full pipeline — feedback → updated prefs → email generation
 *   G. Real MongoDB + OpenAI pipeline (needs .env)
 *
 * Run:  npx tsx examples/memory-system-usage.ts
 */

// Guard: set dummy keys before imports touch config/env.ts
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "DUMMY_KEY_FOR_EXAMPLES";
}

import { MemoryExtractor } from "../src/services/memory.extractor";
import { MemoryService } from "../src/services/memory.service";
import { WriterAgent } from "../src/agents/writer.agent";
import { MockLLMProvider } from "../src/services/llm.provider";
import {
  Lead,
  UserPreferences,
  EmailRequest,
  MemoryExtractionResult,
} from "../src/types";

// ─── Helpers ─────────────────────────────────────────────

function divider(title: string): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}\n`);
}

function printExtraction(result: MemoryExtractionResult): void {
  console.log(`  detected : ${result.detected}`);
  console.log(`  usedLLM  : ${result.usedLLM}`);
  console.log(`  explain  : ${result.explanation}`);
  if (result.updates.length > 0) {
    console.log(`  updates  :`);
    for (const u of result.updates) {
      console.log(
        `    • ${u.operation} ${u.field} → "${u.value}" (confidence: ${u.confidence})`
      );
    }
  }
}

function printPreferences(prefs: UserPreferences): void {
  console.log(`  tone           : ${prefs.tone}`);
  console.log(`  preferredLength: ${prefs.preferredLength}`);
  console.log(`  signOff        : ${prefs.signOff}`);
  console.log(`  signature      : ${prefs.signature || "(none)"}`);
  console.log(`  senderName     : ${prefs.senderName}`);
  console.log(`  senderTitle    : ${prefs.senderTitle}`);
  console.log(`  companyName    : ${prefs.companyName}`);
  console.log(`  avoidPhrases   : [${prefs.avoidPhrases.join(", ")}]`);
  console.log(`  styleNotes     : [${(prefs.styleNotes ?? []).join(", ")}]`);
}

// ─── Sample Data ─────────────────────────────────────────

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
  estimatedValue: 85000,
  tags: ["payments", "api-first", "series-b"],
  notes: "Met at FinTech Connect 2024. Interested in API integration.",
  createdAt: new Date("2024-11-15"),
  lastContactedAt: new Date("2025-01-10"),
};

const basePrefs: UserPreferences = {
  userId: "example_user",
  tone: "professional",
  preferredLength: "medium",
  signature: "",
  signOff: "Best regards",
  senderName: "Alex Morgan",
  senderTitle: "Account Executive",
  companyName: "TechSolutions Corp",
  avoidPhrases: ["touching base", "circle back", "synergy"],
  styleNotes: [],
  preferredTemplates: [],
  updatedAt: new Date(),
};

// ═══════════════════════════════════════════════════════════
// A. MemoryExtractor — Rule-based extraction (no LLM)
// ═══════════════════════════════════════════════════════════

async function exampleA(): Promise<void> {
  divider("Example A: Rule-Based Feedback Extraction");

  const extractor = new MemoryExtractor(); // no LLM provider

  const feedbackSamples = [
    "Make my emails shorter",
    "Use a friendly tone",
    "Don't say low-hanging fruit",
    "Sign off with Cheers",
    "Make it more detailed",
    "Use the sign-off to Kind regards",
    "My name is Jordan Blake",
    "I work for Acme Corp",
    "Always include a PS line with a fun fact",
    "Use set signature to Jordan Blake | VP Sales | Acme Corp",
    "This is just a normal message with no preferences", // should detect nothing
  ];

  for (const fb of feedbackSamples) {
    console.log(`\n  Feedback: "${fb}"`);
    const result = await extractor.extract(fb);
    printExtraction(result);
  }
}

// ═══════════════════════════════════════════════════════════
// B. MemoryExtractor — LLM fallback (MockLLMProvider)
// ═══════════════════════════════════════════════════════════

async function exampleB(): Promise<void> {
  divider("Example B: LLM Fallback Extraction (mock)");

  // Mock LLM returns a JSON array simulating what the real LLM would produce
  const mockLLM = new MockLLMProvider([
    JSON.stringify([
      {
        field: "tone",
        value: "consultative",
        operation: "set",
        confidence: 0.85,
      },
      {
        field: "styleNotes",
        value: "Ask open-ended questions",
        operation: "append",
        confidence: 0.7,
      },
    ]),
  ]);

  const extractor = new MemoryExtractor(mockLLM);

  // This feedback won't match any rule, so it falls back to LLM
  const feedback =
    "I want my emails to sound more like a trusted advisor asking questions rather than selling";

  console.log(`  Feedback: "${feedback}"`);
  const result = await extractor.extract(feedback);
  printExtraction(result);
}

// ═══════════════════════════════════════════════════════════
// C. MemoryService — applyFeedback + preference evolution
//    (in-memory only, no MongoDB)
// ═══════════════════════════════════════════════════════════

async function exampleC(): Promise<void> {
  divider("Example C: Preference Evolution via Feedback");

  // We can't use the real MemoryService without MongoDB, but we can
  // show the MemoryExtractor output and simulate what would happen.
  const extractor = new MemoryExtractor();

  console.log("  Starting preferences:");
  printPreferences(basePrefs);

  // Simulate a series of feedback events
  const feedbackSequence = [
    "Make my emails shorter",
    "Use a casual tone",
    "Don't say touching base",
    "Sign off with Cheers",
    "Always mention our new API launch",
  ];

  // Clone preferences for simulation
  let currentPrefs = { ...basePrefs };

  for (const fb of feedbackSequence) {
    console.log(`\n  ─── Feedback: "${fb}" ───`);
    const extraction = await extractor.extract(fb);

    if (extraction.detected) {
      // Simulate applying updates
      for (const u of extraction.updates) {
        const field = u.field as keyof UserPreferences;
        if (u.operation === "set") {
          (currentPrefs as Record<string, unknown>)[field] = u.value;
        } else if (u.operation === "append" && Array.isArray(currentPrefs[field])) {
          (currentPrefs[field] as string[]).push(String(u.value));
        } else if (u.operation === "remove" && Array.isArray(currentPrefs[field])) {
          (currentPrefs as Record<string, unknown>)[field] = (
            currentPrefs[field] as string[]
          ).filter((v: string) => v.toLowerCase() !== String(u.value).toLowerCase());
        }
      }
      console.log(`  ${extraction.explanation}`);
    } else {
      console.log(`  No preference signal detected.`);
    }
  }

  console.log("\n  Final preferences after all feedback:");
  printPreferences(currentPrefs);
}

// ═══════════════════════════════════════════════════════════
// D. WriterAgent integration — preferences flow into prompts
// ═══════════════════════════════════════════════════════════

async function exampleD(): Promise<void> {
  divider("Example D: WriterAgent with Memory Preferences");

  const mockLLM = new MockLLMProvider();
  const writer = new WriterAgent(mockLLM);

  // Show that preferredLength, signature, and styleNotes flow through
  const prefsWithMemory: UserPreferences = {
    ...basePrefs,
    tone: "friendly",
    preferredLength: "short",
    signature: "Alex Morgan | AE | TechSolutions Corp\n📞 +1-555-0100",
    styleNotes: ["Include a PS with a fun fact", "Use emojis sparingly"],
    signOff: "Cheers",
  };

  console.log("  Preferences being injected:");
  printPreferences(prefsWithMemory);

  const request: EmailRequest = {
    lead: sampleLead,
    preferences: prefsWithMemory,
    emailType: "first_outreach",
    // Note: no explicit `length` — it should use preferredLength from memory
  };

  console.log(
    "\n  Note: request.length is NOT set — the prompt system will use"
  );
  console.log(
    "  preferences.preferredLength ('short') as the default → 80 word limit."
  );

  const result = await writer.execute(request);
  console.log(`\n  Generated email (mock):`);
  console.log(`    Subject: ${result.draft.subject}`);
  console.log(`    Body preview: ${result.draft.body.slice(0, 120)}...`);
  console.log(`    Template: ${result.draft.templateUsed}`);
  console.log(`    Generation: ${result.draft.generationMs}ms`);
}

// ═══════════════════════════════════════════════════════════
// E. Full pipeline: feedback → extract → (simulate) apply → email
// ═══════════════════════════════════════════════════════════

async function exampleE(): Promise<void> {
  divider("Example E: Full Pipeline — Feedback → Email");

  const extractor = new MemoryExtractor();
  const mockLLM = new MockLLMProvider();
  const writer = new WriterAgent(mockLLM);

  // Start with base preferences
  let prefs = { ...basePrefs };
  console.log("  Initial preferences:");
  printPreferences(prefs);

  // User gives feedback
  const feedback = "Make it shorter and use a friendly tone";
  console.log(`\n  User feedback: "${feedback}"`);

  // Extract (will match two rules: length + tone)
  const extraction = await extractor.extract(feedback);
  printExtraction(extraction);

  // Simulate applying updates
  for (const u of extraction.updates) {
    if (u.operation === "set") {
      (prefs as Record<string, unknown>)[u.field] = u.value;
    }
  }

  console.log("\n  Updated preferences:");
  printPreferences(prefs);

  // Generate email with updated preferences
  const request: EmailRequest = {
    lead: sampleLead,
    preferences: prefs,
    emailType: "first_outreach",
  };

  const result = await writer.execute(request);
  console.log(`\n  Email generated with updated prefs (mock):`);
  console.log(`    Subject: ${result.draft.subject}`);
  console.log(`    Body: ${result.draft.body.slice(0, 150)}...`);
}

// ═══════════════════════════════════════════════════════════
// F. Avoid phrase management
// ═══════════════════════════════════════════════════════════

async function exampleF(): Promise<void> {
  divider("Example F: Avoid Phrase Management");

  const extractor = new MemoryExtractor();

  // Add a phrase
  console.log('  Feedback: "Don\'t say game-changer"');
  const add = await extractor.extract("Don't say game-changer");
  printExtraction(add);

  // Remove a previously banned phrase
  console.log('\n  Feedback: "You can start saying synergy again"');
  const remove = await extractor.extract("You can start saying synergy again");
  printExtraction(remove);
}

// ═══════════════════════════════════════════════════════════
// G. Real MongoDB + OpenAI (needs .env)
// ═══════════════════════════════════════════════════════════

async function exampleG(): Promise<void> {
  divider("Example G: Real MongoDB + OpenAI Memory Pipeline");

  // Guard: skip if no real API key
  if (
    !process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY === "DUMMY_KEY_FOR_EXAMPLES"
  ) {
    console.log(
      "  ⊘ Skipping: set OPENAI_API_KEY in .env to run this example.\n"
    );
    return;
  }

  const { OpenAIProvider } = await import("../src/services/llm.provider");
  const { connectDB, closeDB } = await import("../src/database");
  const { config } = await import("../src/config/env");

  try {
    await connectDB();
    console.log("  ✓ Connected to MongoDB\n");

    const llm = new OpenAIProvider(config.openaiApiKey, config.openaiModel);
    const memory = new MemoryService(llm);
    const writer = new WriterAgent(llm);

    const userId = "memory_example_user";

    // 1) Show initial preferences
    console.log("  Step 1: Initial preferences");
    const initial = await memory.getPreferences(userId);
    printPreferences(initial);

    // 2) Apply feedback: "Make emails shorter"
    console.log('\n  Step 2: Applying feedback → "Make emails shorter"');
    const r1 = await memory.applyFeedback(userId, "Make emails shorter");
    printExtraction(r1);

    // 3) Apply feedback: "Use a friendly tone"
    console.log('\n  Step 3: Applying feedback → "Use a friendly tone"');
    const r2 = await memory.applyFeedback(userId, "Use a friendly tone");
    printExtraction(r2);

    // 4) Apply feedback: "Don't say game-changer"
    console.log('\n  Step 4: Applying feedback → "Don\'t say game-changer"');
    const r3 = await memory.applyFeedback(
      userId,
      "Don't say game-changer"
    );
    printExtraction(r3);

    // 5) Apply LLM-based feedback (something rules might not catch)
    console.log(
      '\n  Step 5: Applying feedback → "I want emails that feel like genuine conversation, not a pitch"'
    );
    const r4 = await memory.applyFeedback(
      userId,
      "I want emails that feel like genuine conversation, not a pitch"
    );
    printExtraction(r4);

    // 6) Get snapshot
    console.log("\n  Step 6: Memory snapshot");
    const snapshot = await memory.getSnapshot(userId);
    console.log(`  Feedback count: ${snapshot.feedbackCount}`);
    console.log(`  Last updated: ${snapshot.lastUpdated.toISOString()}`);
    console.log("  Current preferences:");
    printPreferences(snapshot.preferences);

    if (snapshot.recentFeedback.length > 0) {
      console.log("\n  Recent feedback history:");
      for (const fb of snapshot.recentFeedback) {
        console.log(`    • "${fb.feedback}" (${fb.updates.length} updates)`);
      }
    }

    // 7) Generate an email with the evolved preferences
    console.log("\n  Step 7: Generate email with evolved preferences");
    const emailReq: EmailRequest = {
      lead: sampleLead,
      preferences: snapshot.preferences,
      emailType: "first_outreach",
    };
    const result = await writer.execute(emailReq);
    console.log(`    Subject: ${result.draft.subject}`);
    console.log(`    Body:\n${result.draft.body}`);

    // Clean up test data
    const { UserPreferencesModel, FeedbackRecordModel } = await import(
      "../src/database"
    );
    await UserPreferencesModel.deleteOne({ userId });
    await FeedbackRecordModel.deleteMany({ userId });
    console.log(`\n  ✓ Cleaned up test data for ${userId}`);

    await closeDB();
    console.log("  ✓ Disconnected from MongoDB");
  } catch (err) {
    console.error("  ✗ Error:", err);
    const { closeDB: close } = await import("../src/database");
    await close();
  }
}

// ─── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║         User Memory System — Examples             ║");
  console.log("╚════════════════════════════════════════════════════╝");

  await exampleA(); // Rule-based extraction
  await exampleB(); // LLM fallback extraction
  await exampleC(); // Preference evolution
  await exampleD(); // WriterAgent integration
  await exampleE(); // Full pipeline
  await exampleF(); // Avoid phrase management
  await exampleG(); // Real MongoDB + OpenAI

  console.log("\n✓ All memory system examples complete.\n");
}

main().catch(console.error);
