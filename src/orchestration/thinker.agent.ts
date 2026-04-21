import { config } from "../config/env";
import { CalendarAgent, CalendarConflictError } from "../agents/calendar.agent";
import { LeadAgent } from "../agents/lead.agent";
import { WriterAgent } from "../agents/writer.agent";
import { MemoryService } from "../services/memory.service";
import { OpenAIProvider, ILLMProvider, LLMGenerateResult } from "../services/llm.provider";
import {
  EmailDraft,
  EmailType,
  ExecutionPlan,
  CreateMeetingInput,
  LeadQuery,
  LeadAgentResult,
  Meeting,
  PlannerOutput,
  ReasoningStep,
  StepStatus,
  ThinkingResult,
  Lead,
  Intent,
  UserPreferences,
} from "../types";

// ─── Planning Prompt ─────────────────────────────────────

const PLANNING_PROMPT = `You are the Thinker — the core orchestrator of a CRM sales assistant.

Your job: analyze the user's natural-language request, extract entities,
classify intent, and produce a structured JSON execution plan.

## Available agents

| Agent          | Purpose                                                             |
|----------------|---------------------------------------------------------------------|
| lead_agent     | Retrieves leads from MongoDB. Filters: name, company, industry,     |
|                | location, dealStage, companySize, search (full-text), limit.        |
| writer_agent   | Generates personalised sales emails. Types: first_outreach,         |
|                | follow_up, re_engagement. Needs lead data + user preferences.       |
| calendar_agent | Manages meetings: create, list, delete. Prevents overlapping slots. |

## Intents

| Intent              | When to use                                                     |
|---------------------|-----------------------------------------------------------------|
| fetch_leads         | User only wants to find/list leads                              |
| write_email         | User wants an email for a specific lead (by name/company)       |
| fetch_and_email     | User wants to find leads by filter AND write emails for them    |
| schedule_meeting    | User wants to book/schedule a meeting                            |
| list_meetings       | User wants to view meetings                                      |
| delete_meeting      | User wants to cancel/delete a meeting                            |
| update_preferences  | User wants to change their email preferences (tone, sign-off…)  |
| summarize           | User wants a summary of past interactions/conversations         |
| general_query       | Anything else / unclear request                                 |

## Output schema (strict JSON — no markdown fences, no extra text)

{
  "intent": "<one of the intents above>",
  "steps": ["<human-readable step 1>", "<step 2>", ...],
  "agentsNeeded": ["lead_agent", "writer_agent"],
  "entities": {
    "contactName": "<extracted person name or null>",
    "company": "<extracted company name or null>"
  },
  "leadQuery": {
    "name": "<contact name filter or null>",
    "company": "<company name filter or null>",
    "industry": "<industry filter or null>",
    "location": "<location filter or null>",
    "dealStage": "<prospecting|qualified|proposal|negotiation|closed_won|closed_lost or null>",
    "companySize": "<startup|mid-market|enterprise or null>",
    "search": "<full-text search query or null>",
    "limit": 5
  },
  "emailType": "<first_outreach|follow_up|re_engagement or null>",
  "customInstructions": "<special instructions for email or empty string>",
  "meetingInput": {
    "title": "<meeting title or null>",
    "startTime": "<ISO datetime or null>",
    "endTime": "<ISO datetime or null>",
    "leadId": "<lead id if already known, else null>"
  },
  "meetingQuery": {
    "meetingId": "<meeting id for cancellation when explicitly provided, else null>",
    "title": "<title filter or null>",
    "leadId": "<lead id filter or null>",
    "company": "<company filter or null>",
    "contactName": "<contact filter or null>",
    "from": "<ISO datetime lower bound or null>",
    "to": "<ISO datetime upper bound or null>",
    "limit": 20
  },
  "preferenceUpdate": {
    "field": "<tone|preferredLength|signature|signOff|senderName|senderTitle|companyName|avoidPhrases|styleNotes or null>",
    "value": "<new value>",
    "operation": "<set|append|remove — default set>",
    "feedbackText": "<raw user feedback if this is implicit preference change, e.g. 'make it shorter'>"
  },
  "summarizeTarget": "<entity name to focus summary on, or null>"
}

## Rules

1. Include "leadQuery" ONLY when lead_agent is needed.
2. Include "emailType" ONLY when writer_agent is needed. Default "first_outreach" if unclear.
3. Include "meetingInput" ONLY for schedule_meeting intent.
4. Include "meetingQuery" ONLY for list_meetings and delete_meeting intents.
5. Include "preferenceUpdate" ONLY for update_preferences intent.
6. Include "summarizeTarget" ONLY for summarize intent.
7. Always extract entities (contactName, company) when mentioned in the request.
8. For "write_email", set leadQuery.name and/or leadQuery.company to locate the specific lead.
9. For "fetch_and_email", set leadQuery filters (industry, location, etc.) to find matching leads.
10. For "schedule_meeting", include leadQuery and/or entities to identify the lead when leadId is unknown.
11. For "delete_meeting", include meetingQuery.meetingId when provided, otherwise use title/company/contactName filters.
12. steps[] should be 2-5 short sentences describing what will happen.
13. Output ONLY valid JSON. No explanation, no markdown fences.`;

// ─── Options ─────────────────────────────────────────────

/**
 * Dependency-injection options for ThinkerAgent.
 *
 * Every field is optional — production uses real defaults,
 * tests can inject mocks for any or all components.
 */
export interface ThinkerAgentOptions {
  llmProvider?: ILLMProvider;
  calendarAgent?: CalendarAgent;
  leadAgent?: LeadAgent;
  writerAgent?: WriterAgent;
  memoryService?: MemoryService;
}

// ─── ThinkerAgent ────────────────────────────────────────

/**
 * ThinkerAgent — the explicit orchestrator.
 *
 * ## Responsibilities
 *
 * 1. **Analyze** user input via LLM → structured `PlannerOutput`.
 * 2. **Route** to the correct execution handler based on intent.
 * 3. **Chain** agents when a workflow requires sequential calls
 *    (e.g. fetch lead → write email).
 * 4. **Trace** every decision as a `ReasoningStep` in a JSON array
 *    so the full reasoning pipeline is explicit and auditable.
 * 5. **Return** a `ThinkingResult` with plan, trace, response, and data.
 *
 * ## Supported intents
 *
 * | Intent              | Agents chained                     |
 * |---------------------|------------------------------------|
 * | fetch_leads         | LeadAgent                          |
 * | write_email         | LeadAgent → WriterAgent            |
 * | fetch_and_email     | LeadAgent → WriterAgent (batch)    |
 * | update_preferences  | MemoryService                      |
 * | summarize           | MemoryService → LLM summarisation  |
 * | general_query       | (none — returns help text)         |
 *
 * ## Design choices
 *
 * - **Full DI** — every sub-component (LLM, agents, memory) is
 *   injectable via `ThinkerAgentOptions`. Tests pass mocks; prod
 *   uses real implementations that connect to OpenAI + MongoDB.
 *
 * - **Intent-to-handler routing** — a clean switch dispatches to
 *   private handler methods. Each handler owns its own trace steps,
 *   error recovery, and response assembly.
 *
 * - **Structured reasoning trace** — every step has a `status`
 *   field (success | skipped | error) and optional `durationMs`,
 *   making it easy to debug, audit, or render in a UI.
 */
export class ThinkerAgent {
  private readonly llm: ILLMProvider;
  private readonly calendarAgent: CalendarAgent;
  private readonly leadAgent: LeadAgent;
  private readonly writerAgent: WriterAgent;
  private readonly memory: MemoryService;

  constructor(opts: ThinkerAgentOptions = {}) {
    this.llm =
      opts.llmProvider ??
      new OpenAIProvider(config.openaiApiKey, config.openaiModel);
    this.calendarAgent = opts.calendarAgent ?? new CalendarAgent();
    this.leadAgent = opts.leadAgent ?? new LeadAgent();
    this.writerAgent =
      opts.writerAgent ?? new WriterAgent(this.llm);
    this.memory = opts.memoryService ?? new MemoryService();
  }

  // ─── Public API ────────────────────────────────────────

  /**
   * Process a natural-language user request end-to-end.
   *
   * 1. Load user preferences from memory.
   * 2. Call the LLM planner to classify intent + extract entities.
   * 3. Route to the correct intent handler.
   * 4. Assemble the final response and reasoning trace.
   *
   * Returns a `ThinkingResult` containing the plan, every reasoning
   * step, the user-facing response, and any structured data payloads.
   */
  async process(
    userRequest: string,
    userId = "default_user"
  ): Promise<ThinkingResult> {
    const startTime = Date.now();
    const trace: ReasoningStep[] = [];
    const decisions: ThinkingResult["decisions"] = [];
    const usageAccumulator = { promptTokens: 0, completionTokens: 0, totalTokens: 0, llmCalls: 0 };
    let stepNum = 0;
    let planConfidence = 1.0; // start at 1.0, degrade as issues arise
    let rawPlannerOutput: PlannerOutput | undefined;

    try {
      // ── Step 1: Load user preferences ──────────────────
      stepNum++;
      const prefsStart = Date.now();
      const prefs = await this.memory.getPreferences(userId);
      this.addStep(trace, stepNum, {
        thought:
          "Loading user preferences from memory to personalise agent behaviour.",
        action: "load_preferences",
        agent: null,
        inputSummary: `userId="${userId}"`,
        resultSummary:
          `tone="${prefs.tone}", sender="${prefs.senderName || "(default)"}", ` +
          `company="${prefs.companyName || "(default)"}"`,
        status: "success",
        durationMs: Date.now() - prefsStart,
      });

      // Record personalisation decisions
      if (prefs.tone !== "professional") {
        decisions.push({ decision: `Using ${prefs.tone} tone`, reason: "User preference", source: "memory" });
      }
      if (prefs.preferredLength !== "medium") {
        decisions.push({ decision: `Using ${prefs.preferredLength} length`, reason: "User preference", source: "memory" });
      }
      if (prefs.avoidPhrases.length > 0) {
        decisions.push({ decision: `Avoiding ${prefs.avoidPhrases.length} phrases`, reason: "User preference", source: "memory" });
      }

      // ── Step 2: Analyze & plan via LLM ─────────────────
      stepNum++;
      const planStart = Date.now();
      const { plan: plannerOutput, confidence, llmResult } = await this.createPlanWithMeta(userRequest);
      rawPlannerOutput = plannerOutput;
      planConfidence = confidence;

      // Accumulate LLM usage
      if (llmResult?.usage) {
        usageAccumulator.promptTokens += llmResult.usage.promptTokens;
        usageAccumulator.completionTokens += llmResult.usage.completionTokens;
        usageAccumulator.totalTokens += llmResult.usage.totalTokens;
        usageAccumulator.llmCalls++;
      }

      const plan: ExecutionPlan = {
        intent: plannerOutput.intent,
        steps: plannerOutput.steps,
        agentsNeeded: plannerOutput.agentsNeeded,
      };

      const entityParts = [
        plannerOutput.entities?.contactName &&
          `contact="${plannerOutput.entities.contactName}"`,
        plannerOutput.entities?.company &&
          `company="${plannerOutput.entities.company}"`,
      ].filter(Boolean);
      const entityStr = entityParts.length > 0 ? entityParts.join(", ") : "none";

      this.addStep(trace, stepNum, {
        thought:
          `Analyzed request → intent="${plan.intent}" (confidence: ${(planConfidence * 100).toFixed(0)}%). ` +
          `Extracted entities: ${entityStr}. ` +
          `Plan has ${plan.steps.length} step(s) requiring ` +
          `[${plan.agentsNeeded.join(", ") || "no agents"}].`,
        action: "create_plan",
        agent: null,
        inputSummary: userRequest.slice(0, 120),
        resultSummary:
          `intent=${plan.intent}, agents=[${plan.agentsNeeded.join(", ")}], ` +
          `steps=${plan.steps.length}, confidence=${planConfidence.toFixed(2)}`,
        status: "success",
        durationMs: Date.now() - planStart,
      });

      // ── Step 3: Explain task decomposition ───────────
      stepNum++;
      this.addStep(trace, stepNum, {
        thought:
          "Breaking the request into explicit sub-tasks so each part can be executed independently and transparently.",
        action: "decompose_task",
        agent: null,
        inputSummary: `intent=${plan.intent}`,
        resultSummary:
          plan.steps.length > 0
            ? plan.steps.map((s, i) => `${i + 1}. ${s}`).join(" | ")
            : "No explicit subtasks; returning general guidance.",
        status: "success",
      });

      // ── Step 4: Explain agent routing ────────────────
      stepNum++;
      this.addStep(trace, stepNum, {
        thought:
          "Selecting which specialized agents to call based on intent, required data, and expected output type.",
        action: "route_agents",
        agent: null,
        inputSummary: `intent=${plan.intent}, entities=${entityStr}`,
        resultSummary:
          plan.agentsNeeded.length > 0
            ? `Agent chain: ${plan.agentsNeeded.join(" -> ")}`
            : "No agent required for this intent.",
        status: "success",
      });

      decisions.push({
        decision: `Classified intent as "${plan.intent}"`,
        reason: `LLM analysis of user request`,
        source: "llm",
      });

      decisions.push({
        decision: `Decomposed task into ${plan.steps.length || 1} part(s)`,
        reason: "Improve transparency and traceability of execution planning",
        source: "llm",
      });

      decisions.push({
        decision:
          plan.agentsNeeded.length > 0
            ? `Selected agent chain: ${plan.agentsNeeded.join(" -> ")}`
            : "No agent chain selected",
        reason: "Intent-to-agent routing rules",
        source: "default",
      });

      // ── Step 3: Execute plan via intent router ─────────
      const result = await this.executePlan(
        plannerOutput,
        prefs,
        userId,
        trace,
        stepNum
      );

      // ── Step 4: Finalize ───────────────────────────────
      stepNum = trace.length + 1;
      this.addStep(trace, stepNum, {
        thought: "All steps complete. Assembling final response.",
        action: "finalize",
        agent: null,
        inputSummary: `${result.leads.length} leads, ${result.emails.length} emails`,
        resultSummary:
          result.responseParts.length > 0
            ? "Response assembled successfully"
            : "Empty response",
        status: "success",
      });

      // ── Build data payload ─────────────────────────────
      const data: ThinkingResult["data"] = {};
      if (result.leads.length > 0)
        data.leads = result.leads as unknown as Record<string, unknown>[];
      if (result.emails.length > 0)
        data.emails = result.emails as unknown as Record<string, unknown>[];
      if (result.meetings && result.meetings.length > 0)
        data.meetings = result.meetings as unknown as Record<string, unknown>[];
      if (result.preferences)
        data.preferences = result.preferences as unknown as Record<
          string,
          unknown
        >;

      // ── Compute cost ──────────────────────────────────
      const pricing = this.llm.pricing;
      const estimatedCost =
        (usageAccumulator.promptTokens / 1_000_000) * pricing.inputPer1M +
        (usageAccumulator.completionTokens / 1_000_000) * pricing.outputPer1M;

      const reasoningPayload = {
        plan,
        rawPlan: rawPlannerOutput,
        taskBreakdown: plan.steps,
        agentsPlanned: plan.agentsNeeded,
        entities: rawPlannerOutput?.entities,
        leadQuery: rawPlannerOutput?.leadQuery,
        emailType: rawPlannerOutput?.emailType,
        customInstructions: rawPlannerOutput?.customInstructions,
        reasoningTrace: trace,
        decisions: decisions.length > 0 ? decisions : undefined,
        confidence: planConfidence,
        usage: {
          totalPromptTokens: usageAccumulator.promptTokens,
          totalCompletionTokens: usageAccumulator.completionTokens,
          totalTokens: usageAccumulator.totalTokens,
          estimatedCost: Math.round(estimatedCost * 1_000_000) / 1_000_000,
          llmCalls: usageAccumulator.llmCalls,
        },
        totalDurationMs: Date.now() - startTime,
      };

      // Update the already-created interaction log with rich reasoning JSON.
      // We do this here to ensure the stored payload includes the complete trace.
      try {
        await this.memory.logInteraction({
          userId,
          request: userRequest,
          intent: plan.intent,
          agentsUsed: plan.agentsNeeded,
          outcomeSummary: `${result.leads.length} leads, ${result.emails.length} emails`,
          reasoning: reasoningPayload,
          timestamp: new Date(),
        });
      } catch {
        // Logging failure should never break the main response
      }

      return {
        userRequest,
        plan,
        reasoningTrace: trace,
        finalResponse: result.responseParts.join("\n\n"),
        success: true,
        data: Object.keys(data).length > 0 ? data : undefined,
        confidence: planConfidence,
        rawPlan: rawPlannerOutput,
        decisions: decisions.length > 0 ? decisions : undefined,
        usage: {
          totalPromptTokens: usageAccumulator.promptTokens,
          totalCompletionTokens: usageAccumulator.completionTokens,
          totalTokens: usageAccumulator.totalTokens,
          estimatedCost: Math.round(estimatedCost * 1_000_000) / 1_000_000,
          llmCalls: usageAccumulator.llmCalls,
        },
        totalDurationMs: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (err) {
      // ── Catastrophic error — still return a valid result ──
      const errorMsg = err instanceof Error ? err.message : String(err);
      stepNum = trace.length + 1;
      this.addStep(trace, stepNum, {
        thought: `Fatal error during orchestration: ${errorMsg}`,
        action: "error",
        agent: null,
        inputSummary: userRequest.slice(0, 120),
        resultSummary: errorMsg,
        status: "error",
      });

      return {
        userRequest,
        plan: { intent: "general_query", steps: [], agentsNeeded: [] },
        reasoningTrace: trace,
        finalResponse: `I encountered an error processing your request: ${errorMsg}`,
        success: false,
        error: errorMsg,
        confidence: 0,
        totalDurationMs: Date.now() - startTime,
        timestamp: new Date(),
      };
    }
  }

  // ─── Intent Router ─────────────────────────────────────

  /**
   * Routes the validated plan to the correct handler.
   *
   * Each handler is responsible for:
   *  - Calling the right agent(s) in sequence.
   *  - Appending its own reasoning steps to the trace.
   *  - Returning structured results + response text.
   */
  private async executePlan(
    plan: PlannerOutput,
    prefs: UserPreferences,
    userId: string,
    trace: ReasoningStep[],
    stepOffset: number
  ): Promise<ExecutionResult> {
    switch (plan.intent) {
      case "fetch_leads":
        return this.handleFetchLeads(plan, trace, stepOffset);

      case "write_email":
        return this.handleWriteEmail(plan, prefs, trace, stepOffset);

      case "fetch_and_email":
        return this.handleFetchAndEmail(plan, prefs, trace, stepOffset);

      case "schedule_meeting":
        return this.handleScheduleMeeting(plan, trace, stepOffset);

      case "list_meetings":
        return this.handleListMeetings(plan, trace, stepOffset);

      case "delete_meeting":
        return this.handleDeleteMeeting(plan, trace, stepOffset);

      case "update_preferences":
        return this.handleUpdatePreferences(plan, prefs, userId, trace, stepOffset);

      case "summarize":
        return this.handleSummarize(plan, userId, trace, stepOffset);

      case "general_query":
      default:
        return this.handleGeneralQuery(plan, trace, stepOffset);
    }
  }

  // ─── Intent Handlers ──────────────────────────────────

  /**
   * fetch_leads — find leads matching the query and return them.
   * No email generation.
   */
  private async handleFetchLeads(
    plan: PlannerOutput,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    stepNum++;
    const query = this.buildLeadQuery(plan);
    const start = Date.now();

    try {
      const result: LeadAgentResult = await this.leadAgent.execute(query);
      this.addStep(trace, stepNum, {
        thought: `Querying leads with filters: ${this.summarizeQuery(query)}.`,
        action: "fetch_leads",
        agent: "lead_agent",
        inputSummary: this.summarizeQuery(query),
        resultSummary:
          `Found ${result.leads.length} of ${result.totalCount} total ` +
          `(${result.durationMs}ms)`,
        status: "success",
        durationMs: Date.now() - start,
      });

      const responseParts: string[] = [];
      if (result.leads.length > 0) {
        const lines = result.leads.map(
          (l) =>
            `  • ${l.contactName} — ${l.contactTitle || "N/A"} at ` +
            `${l.company} (${l.industry}, ${l.location})`
        );
        responseParts.push(
          `Found ${result.leads.length} lead${result.leads.length === 1 ? "" : "s"}:\n` +
            lines.join("\n")
        );
      } else {
        responseParts.push("No leads found matching your criteria.");
      }

      return { leads: result.leads, emails: [], responseParts };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addStep(trace, stepNum, {
        thought: `Lead search failed: ${msg}`,
        action: "fetch_leads",
        agent: "lead_agent",
        inputSummary: this.summarizeQuery(query),
        resultSummary: msg,
        status: "error",
        durationMs: Date.now() - start,
      });
      return {
        leads: [],
        emails: [],
        responseParts: [`Lead search failed: ${msg}`],
      };
    }
  }

  /**
   * write_email — locate a specific lead by name/company, then
   * generate one email for that lead.
   *
   * Chain: LeadAgent → WriterAgent
   */
  private async handleWriteEmail(
    plan: PlannerOutput,
    prefs: UserPreferences,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    // ── Step A: Find the specific lead ─────────────────
    stepNum++;
    const query = this.buildLeadQuery(plan);
    // If the planner didn't put name/company in leadQuery, fall back to entities
    if (!query.name && !query.company && !query.search) {
      if (plan.entities?.contactName) query.name = plan.entities.contactName;
      if (plan.entities?.company) query.company = plan.entities.company;
    }
    query.limit = query.limit ?? 1;

    const leadStart = Date.now();
    let leads: Lead[] = [];

    try {
      const result = await this.leadAgent.execute(query);
      leads = result.leads;
      this.addStep(trace, stepNum, {
        thought:
          `Looking up lead: ${plan.entities?.contactName || "?"} ` +
          `at ${plan.entities?.company || "?"}`,
        action: "find_lead",
        agent: "lead_agent",
        inputSummary: this.summarizeQuery(query),
        resultSummary:
          leads.length > 0
            ? `Found: ${leads[0].contactName} at ${leads[0].company}`
            : "No matching lead found",
        status: leads.length > 0 ? "success" : "error",
        durationMs: Date.now() - leadStart,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addStep(trace, stepNum, {
        thought: `Lead lookup failed: ${msg}`,
        action: "find_lead",
        agent: "lead_agent",
        inputSummary: this.summarizeQuery(query),
        resultSummary: msg,
        status: "error",
        durationMs: Date.now() - leadStart,
      });
      return {
        leads: [],
        emails: [],
        responseParts: [`Could not find lead: ${msg}`],
      };
    }

    if (leads.length === 0) {
      const nameHint = [
        plan.entities?.contactName,
        plan.entities?.company,
      ]
        .filter(Boolean)
        .join(" at ");
      return {
        leads: [],
        emails: [],
        responseParts: [
          `No lead found matching "${nameHint || "(unknown)"}". ` +
            `Please check the name/company and try again.`,
        ],
      };
    }

    // ── Step B: Generate email for that lead ────────────
    stepNum++;
    const lead = leads[0];
    const emailType = (plan.emailType ?? "first_outreach") as EmailType;
    const emailStart = Date.now();

    try {
      const writerResult = await this.writerAgent.execute({
        lead,
        preferences: prefs,
        emailType,
        customInstructions: plan.customInstructions,
      });

      this.addStep(trace, stepNum, {
        thought:
          `Generating ${emailType} email for ` +
          `${lead.contactName} at ${lead.company}.`,
        action: "generate_email",
        agent: "writer_agent",
        inputSummary: `lead="${lead.company}", type="${emailType}"`,
        resultSummary:
          `Subject: "${writerResult.draft.subject}" ` +
          `(${writerResult.draft.generationMs}ms)`,
        status: "success",
        durationMs: Date.now() - emailStart,
      });

      const emailText =
        `**To: ${writerResult.draft.leadContact} ` +
        `<${writerResult.draft.leadEmail}> (${writerResult.draft.leadCompany})**\n` +
        `Subject: ${writerResult.draft.subject}\n\n${writerResult.draft.body}`;

      return { leads, emails: [writerResult.draft], responseParts: [emailText] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addStep(trace, stepNum, {
        thought: `Email generation failed for ${lead.company}: ${msg}`,
        action: "generate_email",
        agent: "writer_agent",
        inputSummary: `lead="${lead.company}", type="${emailType}"`,
        resultSummary: msg,
        status: "error",
        durationMs: Date.now() - emailStart,
      });
      return {
        leads,
        emails: [],
        responseParts: [`Email generation failed: ${msg}`],
      };
    }
  }

  /**
   * fetch_and_email — find leads by filter, then generate an
   * email for every matching lead.
   *
   * Chain: LeadAgent → WriterAgent (×N)
   */
  private async handleFetchAndEmail(
    plan: PlannerOutput,
    prefs: UserPreferences,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    // ── Step A: Fetch leads by filter ──────────────────
    stepNum++;
    const query = this.buildLeadQuery(plan);
    const leadStart = Date.now();
    let leads: Lead[] = [];

    try {
      const result = await this.leadAgent.execute(query);
      leads = result.leads;
      this.addStep(trace, stepNum, {
        thought: "Searching for leads matching filters to send emails.",
        action: "fetch_leads",
        agent: "lead_agent",
        inputSummary: this.summarizeQuery(query),
        resultSummary:
          `Found ${result.leads.length} of ${result.totalCount} total ` +
          `(${result.durationMs}ms)`,
        status: "success",
        durationMs: Date.now() - leadStart,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addStep(trace, stepNum, {
        thought: `Lead search failed: ${msg}`,
        action: "fetch_leads",
        agent: "lead_agent",
        inputSummary: this.summarizeQuery(query),
        resultSummary: msg,
        status: "error",
        durationMs: Date.now() - leadStart,
      });
      return {
        leads: [],
        emails: [],
        responseParts: [`Lead search failed: ${msg}`],
      };
    }

    if (leads.length === 0) {
      stepNum++;
      this.addStep(trace, stepNum, {
        thought: "No leads found — skipping email generation.",
        action: "skip_emails",
        agent: "writer_agent",
        inputSummary: "0 leads",
        resultSummary: "Skipped — nothing to email",
        status: "skipped",
      });
      return {
        leads: [],
        emails: [],
        responseParts: [
          "No leads found matching your criteria. No emails generated.",
        ],
      };
    }

    // ── Step B: Generate emails for each lead ──────────
    const emailType = (plan.emailType ?? "first_outreach") as EmailType;
    const emails: EmailDraft[] = [];
    const errors: string[] = [];

    for (const lead of leads) {
      stepNum++;
      const emailStart = Date.now();

      try {
        const writerResult = await this.writerAgent.execute({
          lead,
          preferences: prefs,
          emailType,
          customInstructions: plan.customInstructions,
        });
        emails.push(writerResult.draft);
        this.addStep(trace, stepNum, {
          thought:
            `Generating ${emailType} email for ` +
            `${lead.contactName} at ${lead.company}.`,
          action: "generate_email",
          agent: "writer_agent",
          inputSummary: `lead="${lead.company}", type="${emailType}"`,
          resultSummary:
            `Subject: "${writerResult.draft.subject}" ` +
            `(${writerResult.draft.generationMs}ms)`,
          status: "success",
          durationMs: Date.now() - emailStart,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${lead.company}: ${msg}`);
        this.addStep(trace, stepNum, {
          thought: `Email generation failed for ${lead.company}: ${msg}`,
          action: "generate_email",
          agent: "writer_agent",
          inputSummary: `lead="${lead.company}", type="${emailType}"`,
          resultSummary: msg,
          status: "error",
          durationMs: Date.now() - emailStart,
        });
      }
    }

    const responseParts: string[] = [];
    if (emails.length > 0) {
      const emailTexts = emails.map(
        (e) =>
          `**To: ${e.leadContact} <${e.leadEmail}> (${e.leadCompany})**\n` +
          `Subject: ${e.subject}\n\n${e.body}`
      );
      responseParts.push(
        `Generated ${emails.length} email${emails.length === 1 ? "" : "s"}:\n\n` +
          emailTexts.join("\n\n---\n\n")
      );
    }
    if (errors.length > 0) {
      responseParts.push(
        `Failed for ${errors.length} lead(s):\n` +
          errors.map((e) => `  • ${e}`).join("\n")
      );
    }

    return { leads, emails, responseParts };
  }

  /**
   * schedule_meeting — find the target lead (if needed), then create a meeting
   * through CalendarAgent with overlap protection.
   */
  private async handleScheduleMeeting(
    plan: PlannerOutput,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    stepNum++;

    const meetingInput = plan.meetingInput ?? {};
    const startRaw = meetingInput.startTime;
    const endRaw = meetingInput.endTime;

    if (!startRaw || !endRaw) {
      this.addStep(trace, stepNum, {
        thought: "Cannot schedule meeting because start/end time is missing.",
        action: "schedule_meeting",
        agent: "calendar_agent",
        inputSummary: JSON.stringify(plan.meetingInput ?? {}),
        resultSummary: "Missing startTime or endTime",
        status: "error",
      });
      return {
        leads: [],
        emails: [],
        meetings: [],
        responseParts: [
          "I need both a start time and end time to schedule the meeting.",
        ],
      };
    }

    let leadId = meetingInput.leadId ?? undefined;
    let selectedLead: Lead | null = null;

    if (!leadId) {
      const query = this.buildLeadQuery(plan);
      if (!query.name && plan.entities?.contactName) query.name = plan.entities.contactName;
      if (!query.company && plan.entities?.company) query.company = plan.entities.company;
      query.limit = 1;

      const lookupStart = Date.now();
      try {
        const result = await this.leadAgent.execute(query);
        selectedLead = result.leads[0] ?? null;
        leadId = selectedLead?.id;

        this.addStep(trace, stepNum, {
          thought: "Resolving target lead before scheduling meeting.",
          action: "find_lead_for_meeting",
          agent: "lead_agent",
          inputSummary: this.summarizeQuery(query),
          resultSummary: selectedLead
            ? `Found ${selectedLead.contactName} at ${selectedLead.company}`
            : "No matching lead found",
          status: selectedLead ? "success" : "error",
          durationMs: Date.now() - lookupStart,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.addStep(trace, stepNum, {
          thought: `Lead lookup failed before meeting scheduling: ${msg}`,
          action: "find_lead_for_meeting",
          agent: "lead_agent",
          inputSummary: this.summarizeQuery(query),
          resultSummary: msg,
          status: "error",
          durationMs: Date.now() - lookupStart,
        });
        return {
          leads: [],
          emails: [],
          meetings: [],
          responseParts: [`Could not resolve lead for meeting: ${msg}`],
        };
      }

      if (!leadId) {
        return {
          leads: [],
          emails: [],
          meetings: [],
          responseParts: [
            "I couldn't find the lead for this meeting request. Please specify the contact or company clearly.",
          ],
        };
      }
    }

    stepNum++;
    const calendarStart = Date.now();
    const title = meetingInput.title?.trim() ||
      (selectedLead
        ? `Call with ${selectedLead.contactName} from ${selectedLead.company}`
        : "Sales meeting");

    const createInput: CreateMeetingInput = {
      title,
      leadId,
      startTime: new Date(startRaw),
      endTime: new Date(endRaw),
    };

    try {
      const meeting = await this.calendarAgent.createMeeting(createInput);
      this.addStep(trace, stepNum, {
        thought: "Creating meeting and checking calendar overlap constraints.",
        action: "create_meeting",
        agent: "calendar_agent",
        inputSummary: `${meeting.title} | ${meeting.startTime.toISOString()} → ${meeting.endTime.toISOString()}`,
        resultSummary: `Meeting created with id=${meeting.id}`,
        status: "success",
        durationMs: Date.now() - calendarStart,
      });

      return {
        leads: selectedLead ? [selectedLead] : [],
        emails: [],
        meetings: [meeting],
        responseParts: [
          `Meeting scheduled: **${meeting.title}**\n` +
            `Start: ${meeting.startTime.toISOString()}\n` +
            `End: ${meeting.endTime.toISOString()}\n` +
            `Lead ID: ${meeting.leadId}`,
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addStep(trace, stepNum, {
        thought:
          err instanceof CalendarConflictError
            ? "Rejected meeting due to overlap with an existing booking."
            : `Meeting creation failed: ${msg}`,
        action: "create_meeting",
        agent: "calendar_agent",
        inputSummary: `${title} | ${startRaw} → ${endRaw}`,
        resultSummary: msg,
        status: "error",
        durationMs: Date.now() - calendarStart,
      });

      return {
        leads: selectedLead ? [selectedLead] : [],
        emails: [],
        meetings: [],
        responseParts: [msg],
      };
    }
  }

  /** list_meetings — return upcoming meetings from CalendarAgent. */
  private async handleListMeetings(
    plan: PlannerOutput,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    stepNum++;
    const start = Date.now();

    const query = plan.meetingQuery ?? {};
    const meetings = await this.calendarAgent.listMeetings({
      leadId: query.leadId ?? undefined,
      title: query.title ?? query.company ?? query.contactName ?? undefined,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit ?? 50,
    });

    this.addStep(trace, stepNum, {
      thought: "Listing meetings from calendar store.",
      action: "list_meetings",
      agent: "calendar_agent",
      inputSummary: JSON.stringify(query),
      resultSummary: `Returned ${meetings.length} meeting(s)`,
      status: "success",
      durationMs: Date.now() - start,
    });

    if (meetings.length === 0) {
      return {
        leads: [],
        emails: [],
        meetings: [],
        responseParts: ["No meetings found."],
      };
    }

    const lines = meetings.map(
      (m) =>
        `• ${m.title} — ${m.startTime.toISOString()} to ${m.endTime.toISOString()} (id: ${m.id})`
    );
    return {
      leads: [],
      emails: [],
      meetings,
      responseParts: [`Found ${meetings.length} meeting(s):\n${lines.join("\n")}`],
    };
  }

  /**
   * delete_meeting — deletes by meeting id when available, otherwise
   * resolves by title/company/contact and removes the first match.
   */
  private async handleDeleteMeeting(
    plan: PlannerOutput,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    stepNum++;
    const start = Date.now();
    const q = plan.meetingQuery ?? {};
    const directId = q.meetingId ?? undefined;

    if (directId) {
      const deleted = await this.calendarAgent.deleteMeeting(directId);
      this.addStep(trace, stepNum, {
        thought: "Deleting meeting by explicit id.",
        action: "delete_meeting",
        agent: "calendar_agent",
        inputSummary: `id=${directId}`,
        resultSummary: deleted ? "Deleted" : "Meeting not found",
        status: deleted ? "success" : "error",
        durationMs: Date.now() - start,
      });
      return {
        leads: [],
        emails: [],
        meetings: [],
        responseParts: [deleted ? `Meeting ${directId} deleted.` : `Meeting ${directId} not found.`],
      };
    }

    const titleFilter = q.title ?? q.company ?? q.contactName ?? plan.entities?.company ?? plan.entities?.contactName ?? "";
    const candidates = await this.calendarAgent.listMeetings({
      title: titleFilter || undefined,
      limit: 20,
    });

    const target = candidates[0];
    if (!target) {
      this.addStep(trace, stepNum, {
        thought: "No meeting matched cancellation request.",
        action: "delete_meeting",
        agent: "calendar_agent",
        inputSummary: `filter=${titleFilter || "(empty)"}`,
        resultSummary: "No matching meetings",
        status: "error",
        durationMs: Date.now() - start,
      });
      return {
        leads: [],
        emails: [],
        meetings: [],
        responseParts: ["I could not find a meeting to cancel for that request."],
      };
    }

    const deleted = await this.calendarAgent.deleteMeeting(target.id);
    this.addStep(trace, stepNum, {
      thought: "Deleting first matching meeting from calendar.",
      action: "delete_meeting",
      agent: "calendar_agent",
      inputSummary: `matched=${target.title}`,
      resultSummary: deleted ? `Deleted id=${target.id}` : "Delete failed",
      status: deleted ? "success" : "error",
      durationMs: Date.now() - start,
    });

    return {
      leads: [],
      emails: [],
      meetings: [],
      responseParts: [
        deleted
          ? `Cancelled meeting: ${target.title} (${target.startTime.toISOString()})`
          : "Failed to cancel the matched meeting.",
      ],
    };
  }

  /**
   * update_preferences — update user preference fields via:
   *
   * 1. **Feedback mode** — if `plan.preferenceUpdate.feedbackText` is set,
   *    delegates to MemoryService.applyFeedback() which uses the
   *    MemoryExtractor (rule-based + LLM fallback) to parse implicit
   *    feedback like "make it shorter" or "don't say synergy".
   *
   * 2. **Direct mode** — if `field` and `value` are set explicitly,
   *    applies a single field update directly.
   */
  private async handleUpdatePreferences(
    plan: PlannerOutput,
    currentPrefs: UserPreferences,
    userId: string,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    stepNum++;
    const update = plan.preferenceUpdate;

    if (!update) {
      this.addStep(trace, stepNum, {
        thought:
          "Preference update requested but no update data could be extracted.",
        action: "update_preferences",
        agent: null,
        inputSummary: "{}",
        resultSummary: "Missing preference update data",
        status: "error",
      });
      return {
        leads: [],
        emails: [],
        responseParts: [
          "I couldn't determine which preference to update. Please specify, " +
            'e.g. "Set my tone to formal", "Make emails shorter", or ' +
            '"Don\'t use the phrase synergy".',
        ],
      };
    }

    // ── Branch 1: Feedback-based extraction ────────────
    if (update.feedbackText) {
      return this.handleFeedbackUpdate(
        update.feedbackText,
        userId,
        trace,
        stepNum
      );
    }

    // ── Branch 2: Direct field assignment ──────────────
    if (!update.field || !update.value) {
      this.addStep(trace, stepNum, {
        thought:
          "Preference update missing field or value, and no feedbackText.",
        action: "update_preferences",
        agent: null,
        inputSummary: JSON.stringify(update),
        resultSummary: "Missing field or value",
        status: "error",
      });
      return {
        leads: [],
        emails: [],
        responseParts: [
          "I couldn't determine which preference to update. Please specify, " +
            'e.g. "Set my tone to formal" or "Change sign-off to Cheers".',
        ],
      };
    }

    // Validate field name
    const allowedFields = [
      "tone",
      "preferredLength",
      "signature",
      "signOff",
      "senderName",
      "senderTitle",
      "companyName",
      "avoidPhrases",
      "styleNotes",
    ];
    if (!allowedFields.includes(update.field)) {
      this.addStep(trace, stepNum, {
        thought: `"${update.field}" is not a recognised preference field.`,
        action: "update_preferences",
        agent: null,
        inputSummary: `field="${update.field}", value="${update.value}"`,
        resultSummary: `Unknown field: ${update.field}`,
        status: "error",
      });
      return {
        leads: [],
        emails: [],
        responseParts: [
          `Unknown preference field "${update.field}". ` +
            `Available: ${allowedFields.join(", ")}.`,
        ],
      };
    }

    const updateStart = Date.now();
    const oldValue = (currentPrefs as unknown as Record<string, unknown>)[
      update.field
    ];
    try {
      // Use applyUpdates for proper audit trail recording
      const operation = (update.operation as "set" | "append" | "remove") || "set";
      const updatedPrefs = await this.memory.applyUpdates(userId, [
        {
          field: update.field as import("../types").UpdatableField,
          value: update.value,
          operation,
          source: `Direct update via ThinkerAgent`,
          confidence: 1.0,
        },
      ], `Set ${update.field} to "${update.value}"`);

      this.addStep(trace, stepNum, {
        thought: `Updating preference: ${update.field} → "${update.value}" (${operation}).`,
        action: "update_preferences",
        agent: null,
        inputSummary: `field="${update.field}", value="${update.value}", op="${operation}"`,
        resultSummary:
          `Updated successfully. ${update.field}: ` +
          `"${String(oldValue)}" → "${update.value}"`,
        status: "success",
        durationMs: Date.now() - updateStart,
      });

      return {
        leads: [],
        emails: [],
        responseParts: [
          `Preference updated: **${update.field}** is now set to ` +
            `"**${update.value}**".\n\nThis will be applied to all future emails.`,
        ],
        preferences: updatedPrefs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addStep(trace, stepNum, {
        thought: `Failed to save preference: ${msg}`,
        action: "update_preferences",
        agent: null,
        inputSummary: `field="${update.field}", value="${update.value}"`,
        resultSummary: msg,
        status: "error",
        durationMs: Date.now() - updateStart,
      });
      return {
        leads: [],
        emails: [],
        responseParts: [`Failed to update preference: ${msg}`],
      };
    }
  }

  /**
   * Process natural-language feedback through the MemoryExtractor
   * and apply any detected preference updates.
   */
  private async handleFeedbackUpdate(
    feedbackText: string,
    userId: string,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    const start = Date.now();

    try {
      const extraction = await this.memory.applyFeedback(
        userId,
        feedbackText
      );

      if (!extraction.detected || extraction.updates.length === 0) {
        this.addStep(trace, stepNum, {
          thought: `Analysed feedback but no preference signals detected.`,
          action: "update_preferences",
          agent: null,
          inputSummary: `feedback="${feedbackText}"`,
          resultSummary: "No preference updates extracted",
          status: "success",
          durationMs: Date.now() - start,
        });
        return {
          leads: [],
          emails: [],
          responseParts: [
            `I processed your feedback but couldn't identify any preference changes. ` +
              `Try being more specific, e.g. "Make emails shorter" or "Use a friendly tone".`,
          ],
        };
      }

      // Build a human-readable summary of what changed
      const changeSummary = extraction.updates
        .map((u) => {
          const op =
            u.operation === "append"
              ? `Added "${u.value}" to **${u.field}**`
              : u.operation === "remove"
                ? `Removed "${u.value}" from **${u.field}**`
                : `Set **${u.field}** to "${u.value}"`;
          return `- ${op}`;
        })
        .join("\n");

      const updatedPrefs = await this.memory.getPreferences(userId);

      this.addStep(trace, stepNum, {
        thought: `Extracted ${extraction.updates.length} update(s) from feedback. ${extraction.explanation}`,
        action: "update_preferences",
        agent: null,
        inputSummary: `feedback="${feedbackText}"`,
        resultSummary: extraction.explanation,
        status: "success",
        durationMs: Date.now() - start,
      });

      return {
        leads: [],
        emails: [],
        responseParts: [
          `I've updated your preferences based on your feedback:\n\n${changeSummary}\n\n` +
            `${extraction.usedLLM ? "(Extracted via LLM analysis)" : "(Extracted via pattern matching)"}\n\n` +
            `These changes will be applied to all future emails.`,
        ],
        preferences: updatedPrefs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addStep(trace, stepNum, {
        thought: `Failed to process feedback: ${msg}`,
        action: "update_preferences",
        agent: null,
        inputSummary: `feedback="${feedbackText}"`,
        resultSummary: msg,
        status: "error",
        durationMs: Date.now() - start,
      });
      return {
        leads: [],
        emails: [],
        responseParts: [`Failed to process feedback: ${msg}`],
      };
    }
  }

  /**
   * summarize — retrieve recent interaction history from memory,
   * optionally filtered to a specific entity, and summarise via LLM.
   *
   * Chain: MemoryService → LLM summarisation
   */
  private async handleSummarize(
    plan: PlannerOutput,
    userId: string,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    // ── Step A: Retrieve interaction history ────────────
    stepNum++;
    const histStart = Date.now();
    let interactions;

    try {
      interactions = await this.memory.getRecentInteractions(userId, 20);
      this.addStep(trace, stepNum, {
        thought: "Retrieving recent interaction history from memory.",
        action: "retrieve_history",
        agent: null,
        inputSummary: `userId="${userId}", limit=20`,
        resultSummary: `Retrieved ${interactions.length} interaction(s)`,
        status: interactions.length > 0 ? "success" : "skipped",
        durationMs: Date.now() - histStart,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addStep(trace, stepNum, {
        thought: `Failed to retrieve history: ${msg}`,
        action: "retrieve_history",
        agent: null,
        inputSummary: `userId="${userId}"`,
        resultSummary: msg,
        status: "error",
        durationMs: Date.now() - histStart,
      });
      return {
        leads: [],
        emails: [],
        responseParts: [`Could not retrieve interaction history: ${msg}`],
      };
    }

    if (interactions.length === 0) {
      return {
        leads: [],
        emails: [],
        responseParts: [
          "No previous interactions found. There's nothing to summarise yet.",
        ],
      };
    }

    // ── Step B: Summarise via LLM ──────────────────────
    stepNum++;
    const target =
      plan.summarizeTarget || plan.entities?.contactName || "all";
    const historyText = interactions
      .map(
        (i, idx) =>
          `[${idx + 1}] Request: "${i.request}" | Intent: ${i.intent} | ` +
          `Agents: [${i.agentsUsed.join(", ")}] | ` +
          `Outcome: ${i.outcomeSummary}`
      )
      .join("\n");

    const sumStart = Date.now();
    try {
      const { text } = await this.llm.generate({
        systemPrompt:
          "You are a CRM assistant summariser. Given the user's interaction " +
          "history, produce a clear, concise summary. " +
          (target !== "all"
            ? `Focus on interactions related to "${target}". `
            : "") +
          "Use bullet points. Be factual — do not invent details.",
        userPrompt: `Summarise the following interaction history:\n\n${historyText}`,
        temperature: 0.3,
      });

      this.addStep(trace, stepNum, {
        thought:
          `Summarising ${interactions.length} interaction(s)` +
          (target !== "all" ? ` (focus: "${target}")` : "") +
          ` via LLM.`,
        action: "summarize",
        agent: null,
        inputSummary: `${interactions.length} interactions, target="${target}"`,
        resultSummary: `Summary generated (${text.length} chars)`,
        status: "success",
        durationMs: Date.now() - sumStart,
      });

      return { leads: [], emails: [], meetings: [], responseParts: [text] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addStep(trace, stepNum, {
        thought: `Summarisation LLM call failed: ${msg}`,
        action: "summarize",
        agent: null,
        inputSummary: `${interactions.length} interactions`,
        resultSummary: msg,
        status: "error",
        durationMs: Date.now() - sumStart,
      });
      return {
        leads: [],
        emails: [],
        responseParts: [`Summarisation failed: ${msg}`],
      };
    }
  }

  /**
   * general_query — fallback when no specific intent is detected.
   * Returns guidance on what the assistant can do.
   */
  private async handleGeneralQuery(
    plan: PlannerOutput,
    trace: ReasoningStep[],
    stepNum: number
  ): Promise<ExecutionResult> {
    stepNum++;
    this.addStep(trace, stepNum, {
      thought:
        "Request doesn't map to a specific agent — providing general guidance.",
      action: "general_response",
      agent: null,
      inputSummary: plan.steps.join("; ").slice(0, 120) || "(empty plan)",
      resultSummary: "Returning help text",
      status: "success",
    });

    return {
      leads: [],
      emails: [],
      responseParts: [
        "I can help you with:\n" +
          '  • **Find leads** — "Show me fintech leads in NYC"\n' +
          '  • **Write emails** — "Write a follow-up email for Sarah at FinFlow"\n' +
          '  • **Find + email** — "Email all startup leads in Austin"\n' +
          '  • **Update preferences** — "Set my tone to casual"\n' +
          '  • **Summarise history** — "Summarise my recent interactions"',
      ],
    };
  }

  // ─── Private Helpers ──────────────────────────────────

  /**
   * Call the LLM to produce a structured execution plan from
   * the user's natural-language request.
   *
   * Falls back to `general_query` if JSON parsing fails.
   */
  private async createPlan(userRequest: string): Promise<PlannerOutput> {
    const { plan } = await this.createPlanWithMeta(userRequest);
    return plan;
  }

  /**
   * Like createPlan but also returns a confidence score and raw LLM result
   * for token tracking and transparency.
   */
  private async createPlanWithMeta(userRequest: string): Promise<{
    plan: PlannerOutput;
    confidence: number;
    llmResult?: LLMGenerateResult;
  }> {
    try {
      const result = await this.llm.generate({
        systemPrompt: PLANNING_PROMPT,
        userPrompt: userRequest,
        temperature: 0.2,
      });

      let raw = result.text.trim();
      let confidence = 1.0;

      // Strip markdown fences if present (slight confidence reduction)
      if (raw.startsWith("```")) {
        raw = raw
          .replace(/^```(?:json)?\n?/, "")
          .replace(/\n?```$/, "")
          .trim();
        confidence *= 0.95; // model didn't follow "no fences" rule
      }

      const parsed = JSON.parse(raw) as PlannerOutput;
      const validated = this.validatePlan(parsed);

      // Reduce confidence if intent was corrected during validation
      const validIntents: Intent[] = [
        "fetch_leads", "write_email", "fetch_and_email",
        "schedule_meeting", "list_meetings", "delete_meeting",
        "update_preferences", "summarize", "general_query",
      ];
      if (!validIntents.includes(parsed.intent)) {
        confidence *= 0.6;
      }

      // Reduce confidence if agents had to be force-added
      if (
        ["fetch_leads", "fetch_and_email", "write_email", "schedule_meeting"].includes(validated.intent) &&
        !parsed.agentsNeeded?.includes("lead_agent")
      ) {
        confidence *= 0.85;
      }

      if (
        ["schedule_meeting", "list_meetings", "delete_meeting"].includes(validated.intent) &&
        !parsed.agentsNeeded?.includes("calendar_agent")
      ) {
        confidence *= 0.85;
      }

      return { plan: validated, confidence, llmResult: result };
    } catch {
      // If LLM returns invalid JSON, degrade gracefully
      return {
        plan: {
          intent: "general_query",
          steps: [
            "Could not parse execution plan — falling back to general guidance.",
          ],
          agentsNeeded: [],
          entities: {},
        },
        confidence: 0.2, // very low confidence on fallback
      };
    }
  }

  /**
   * Normalize + validate a raw PlannerOutput.
   * Ensures intent is valid and agent routing matches the intent.
   */
  private validatePlan(plan: PlannerOutput): PlannerOutput {
    const validIntents: Intent[] = [
      "fetch_leads",
      "write_email",
      "fetch_and_email",
      "schedule_meeting",
      "list_meetings",
      "delete_meeting",
      "update_preferences",
      "summarize",
      "general_query",
    ];

    if (!validIntents.includes(plan.intent)) {
      plan.intent = "general_query";
    }

    plan.steps = Array.isArray(plan.steps) ? plan.steps : [];
    plan.agentsNeeded = Array.isArray(plan.agentsNeeded)
      ? plan.agentsNeeded
      : [];
    plan.entities = plan.entities ?? {};

    // Ensure agent routing is consistent with intent
    if (
      ["fetch_leads", "fetch_and_email", "write_email"].includes(plan.intent)
    ) {
      if (!plan.agentsNeeded.includes("lead_agent")) {
        plan.agentsNeeded.push("lead_agent");
      }
    }
    if (["write_email", "fetch_and_email"].includes(plan.intent)) {
      if (!plan.agentsNeeded.includes("writer_agent")) {
        plan.agentsNeeded.push("writer_agent");
      }
    }
    if (plan.intent === "schedule_meeting") {
      if (!plan.agentsNeeded.includes("lead_agent")) {
        plan.agentsNeeded.push("lead_agent");
      }
    }
    if (["schedule_meeting", "list_meetings", "delete_meeting"].includes(plan.intent)) {
      if (!plan.agentsNeeded.includes("calendar_agent")) {
        plan.agentsNeeded.push("calendar_agent");
      }
    }
    if (plan.intent === "schedule_meeting") {
      plan.agentsNeeded = ["lead_agent", "calendar_agent"];
    }

    return plan;
  }

  /** Convert PlannerOutput.leadQuery → LeadQuery, dropping null values. */
  private buildLeadQuery(plan: PlannerOutput): LeadQuery {
    const lq = plan.leadQuery ?? {};
    const query: LeadQuery = {};

    if (lq.name) query.name = lq.name;
    if (lq.company) query.company = lq.company;
    if (lq.industry) query.industry = lq.industry;
    if (lq.location) query.location = lq.location;
    if (lq.dealStage)
      query.dealStage = lq.dealStage as LeadQuery["dealStage"];
    if (lq.companySize)
      query.companySize = lq.companySize as LeadQuery["companySize"];
    if (lq.search) query.search = lq.search;
    if (lq.limit) query.limit = lq.limit;

    return query;
  }

  /** One-line summary of a LeadQuery for trace output. */
  private summarizeQuery(query: LeadQuery): string {
    const parts = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    return parts.length > 0 ? parts.join(", ") : "(all leads)";
  }

  /** Append a reasoning step to the trace. */
  private addStep(
    trace: ReasoningStep[],
    stepNum: number,
    data: Omit<ReasoningStep, "step" | "timestamp">
  ): void {
    trace.push({ step: stepNum, ...data, timestamp: new Date() });
  }
}

// ─── Internal Types ──────────────────────────────────────

/** Intermediate result from each intent handler. */
interface ExecutionResult {
  leads: Lead[];
  emails: EmailDraft[];
  meetings?: Meeting[];
  responseParts: string[];
  preferences?: UserPreferences;
}
