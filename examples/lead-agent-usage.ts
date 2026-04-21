/**
 * examples/lead-agent-usage.ts
 *
 * Demonstrates how to use the LeadAgent and LeadService in isolation.
 * Run with:  npx tsx examples/lead-agent-usage.ts
 *
 * Prerequisites:
 *   1. MongoDB running locally (or MONGODB_URI set in .env)
 *   2. Seed data loaded:  npx tsx src/database/seed.ts
 */

import { connectDB, closeDB } from "../src/database";
import { LeadAgent } from "../src/agents/lead.agent";
import { LeadService } from "../src/services/lead.service";

async function main() {
  // ── 1. Connect to MongoDB ──────────────────────────────
  await connectDB();
  console.log("✔  Connected to MongoDB\n");

  // ── 2. Instantiate the agent (it creates its own LeadService internally)
  const agent = new LeadAgent();

  // You can also inject a service for shared usage or testing:
  //   const service = new LeadService();
  //   const agent = new LeadAgent(service);

  // ─────────────────────────────────────────────────────────
  //  Example A — Query by contact name
  // ─────────────────────────────────────────────────────────
  console.log("═══ A. Find leads by name ═══");
  const byName = await agent.findByName("Sarah");
  console.log(`Found ${byName.length} lead(s):`);
  for (const lead of byName) {
    console.log(`  • ${lead.contactName} — ${lead.company} (${lead.industry})`);
  }

  // ─────────────────────────────────────────────────────────
  //  Example B — Query by company
  // ─────────────────────────────────────────────────────────
  console.log("\n═══ B. Find leads by company ═══");
  const byCompany = await agent.findByCompany("Nova");
  console.log(`Found ${byCompany.length} lead(s):`);
  for (const lead of byCompany) {
    console.log(`  • ${lead.contactName} — ${lead.company} (${lead.dealStage})`);
  }

  // ─────────────────────────────────────────────────────────
  //  Example C — Query by pipeline stage
  // ─────────────────────────────────────────────────────────
  console.log("\n═══ C. Find leads in 'qualified' stage ═══");
  const byStage = await agent.findByStage("qualified");
  console.log(`Found ${byStage.length} lead(s):`);
  for (const lead of byStage) {
    console.log(
      `  • ${lead.company} — ${lead.contactName} ` +
      `(priority: ${lead.priority}, value: $${lead.estimatedValue?.toLocaleString() ?? "N/A"})`
    );
  }

  // ─────────────────────────────────────────────────────────
  //  Example D — Full execute() with structured result
  //  (this is what the ThinkerAgent calls)
  // ─────────────────────────────────────────────────────────
  console.log("\n═══ D. Full execute() — fintech leads, high priority ═══");
  const result = await agent.execute({
    industry: "fintech",
    priority: "high",
    limit: 3,
    sortBy: "estimatedValue",
    sortOrder: "desc",
  });
  console.log(`Returned ${result.leads.length} of ${result.totalCount} total matches (${result.durationMs}ms):`);
  for (const lead of result.leads) {
    console.log(
      `  • ${lead.company} — $${lead.estimatedValue?.toLocaleString() ?? "?"} ` +
      `(${lead.dealStage}, ${lead.location})`
    );
  }

  // ─────────────────────────────────────────────────────────
  //  Example E — Combine multiple filters
  // ─────────────────────────────────────────────────────────
  console.log("\n═══ E. Combined filter — enterprise SaaS in negotiation ═══");
  const combined = await agent.execute({
    industry: "saas",
    companySize: "enterprise",
    dealStage: "negotiation",
    limit: 5,
  });
  console.log(`Found ${combined.leads.length} of ${combined.totalCount} total:`);
  for (const lead of combined.leads) {
    console.log(`  • ${lead.company} — ${lead.contactName} (${lead.location})`);
  }

  // ─────────────────────────────────────────────────────────
  //  Example F — Pipeline stage distribution
  // ─────────────────────────────────────────────────────────
  console.log("\n═══ F. Pipeline stage distribution ═══");
  const dist = await agent.getStageDistribution();
  for (const [stage, count] of Object.entries(dist)) {
    const bar = "█".repeat(count);
    console.log(`  ${stage.padEnd(14)} ${bar} ${count}`);
  }

  // ─────────────────────────────────────────────────────────
  //  Example G — Overdue follow-ups
  // ─────────────────────────────────────────────────────────
  console.log("\n═══ G. Overdue follow-ups ═══");
  const overdue = await agent.getOverdueFollowUps(5);
  if (overdue.length === 0) {
    console.log("  No overdue follow-ups.");
  } else {
    for (const lead of overdue) {
      console.log(
        `  • ${lead.company} — due ${lead.nextFollowUp?.toLocaleDateString() ?? "?"}`
      );
    }
  }

  // ─────────────────────────────────────────────────────────
  //  Example H — getCapabilities() for Thinker integration
  // ─────────────────────────────────────────────────────────
  console.log("\n═══ H. Agent capabilities (for Thinker planner prompt) ═══");
  const caps = agent.getCapabilities();
  console.log(`Agent: ${caps.agentName}`);
  console.log(`Filters: ${caps.supportedFilters.map(f => f.field).join(", ")}`);
  console.log(`Sorting: ${caps.sorting.sortableFields.join(", ")}`);
  console.log(`Methods: ${caps.convenienceMethods.join(", ")}`);

  // ─────────────────────────────────────────────────────────
  //  Example I — Using LeadService directly
  //  (for routes, scripts, or non-agent consumers)
  // ─────────────────────────────────────────────────────────
  console.log("\n═══ I. LeadService direct usage ═══");
  const service = new LeadService();

  const count = await service.countLeads({ industry: "fintech" });
  console.log(`Total fintech leads: ${count}`);

  const single = await service.findByCompany("Quantum", 1);
  if (single.length > 0) {
    console.log(`First Quantum* lead: ${single[0].contactName} — ${single[0].contactEmail}`);
  }

  // ── Done ───────────────────────────────────────────────
  await closeDB();
  console.log("\n✔  Disconnected from MongoDB");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
