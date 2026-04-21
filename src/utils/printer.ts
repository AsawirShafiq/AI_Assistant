import { ThinkingResult, StepStatus } from "../types";

// ─── Status Indicators ──────────────────────────────────

const STATUS_ICON: Record<StepStatus, string> = {
  success: "✓",
  skipped: "⊘",
  error: "✗",
};

// ─── Reasoning Trace ─────────────────────────────────────

/** Pretty-print the reasoning trace to stdout. */
export function printReasoningTrace(result: ThinkingResult): void {
  console.log("\n" + "═".repeat(60));
  console.log("  REASONING TRACE");
  console.log("═".repeat(60));

  for (const step of result.reasoningTrace) {
    const agentTag = step.agent ? ` [${step.agent}]` : "";
    const statusTag = ` ${STATUS_ICON[step.status] ?? "?"} ${step.status.toUpperCase()}`;
    const durationTag = step.durationMs !== undefined ? ` (${step.durationMs}ms)` : "";

    console.log(
      `\n  Step ${step.step}${agentTag}: ${step.action}${statusTag}${durationTag}`
    );
    console.log(`    Thought: ${step.thought}`);
    if (step.inputSummary) console.log(`    Input:   ${step.inputSummary}`);
    console.log(`    Result:  ${step.resultSummary}`);
  }

  console.log("\n" + "═".repeat(60));
}

// ─── Full Result ─────────────────────────────────────────

/** Pretty-print the full result (plan + trace + response). */
export function printResult(result: ThinkingResult): void {
  const statusLabel = result.success ? "SUCCESS" : "FAILED";
  const totalMs =
    "totalDurationMs" in result
      ? ` | ${result.totalDurationMs}ms`
      : "";

  console.log("\n" + "─".repeat(60));
  console.log(`  PLAN  [${statusLabel}${totalMs}]`);
  console.log("─".repeat(60));
  console.log(`  Intent: ${result.plan.intent}`);
  console.log(`  Agents: [${result.plan.agentsNeeded.join(", ") || "none"}]`);
  console.log(`  Steps:`);
  for (const s of result.plan.steps) {
    console.log(`    → ${s}`);
  }

  printReasoningTrace(result);

  console.log("\n" + "─".repeat(60));
  console.log("  RESPONSE");
  console.log("─".repeat(60));
  console.log(`\n${result.finalResponse}\n`);

  if (result.error) {
    console.log(`  ⚠ Error: ${result.error}\n`);
  }
}
