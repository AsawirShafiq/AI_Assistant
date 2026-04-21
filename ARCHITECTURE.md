# Multi-Agent CRM Assistant — Architecture Document

## 1. System Overview

A modular multi-agent system that acts as a CRM sales assistant. A central **Thinker Agent** orchestrates specialized sub-agents (**Lead Agent**, **Writer Agent**, and **Calendar Agent**) while maintaining persistent **User Memory** in MongoDB. Every decision the orchestrator makes is exposed as an explicit, structured reasoning trace with confidence scoring and cost tracking, and a rich reasoning JSON payload is persisted for audit/debugging.

**Stack:** Node.js · TypeScript 5.7 (strict) · OpenAI GPT-4o-mini · MongoDB / Mongoose · Express 5

---

## 2. Component Responsibilities

### 2.1 Thinker Agent (Orchestrator)

| Aspect | Detail |
|---|---|
| **Role** | Central brain — parses intent, plans multi-step execution, routes to sub-agents, aggregates results |
| **Input** | Raw user request (natural language) + `userId` |
| **Output** | `ThinkingResult` containing reasoning trace, confidence score, cost breakdown, and final payload |
| **Key behavior** | Produces a structured `ReasoningStep[]` log at every decision point. Never calls an LLM silently — every call is recorded with input/output/rationale. Tracks token usage and estimated cost across all LLM calls. |

The Thinker does **not** access databases directly. It delegates all data operations to specialized agents and composes their outputs.

### 2.2 Lead Agent

| Aspect | Detail |
|---|---|
| **Role** | Retrieves & filters lead data from MongoDB |
| **Input** | `LeadQuery` (name, company, industry, location, dealStage, companySize, etc.) |
| **Output** | `Lead[]` — plain TypeScript interfaces (no Mongoose internals) |
| **Key behavior** | Pure data agent — no LLM calls. Translates structured queries into MongoDB filters (regex for strings, exact match for enums). Independently callable and testable. |

### 2.3 Writer Agent

| Aspect | Detail |
|---|---|
| **Role** | Generates personalised sales emails |
| **Input** | `EmailRequest` (lead data + user preferences + optional template hint) |
| **Output** | `EmailDraft` (subject, body, metadata including tone, word count, model, duration) |
| **Key behavior** | Uses the `ILLMProvider` abstraction with a sales-tuned system prompt. Reads user preferences from Memory to match tone/style. Each email generation is a single, auditable LLM call. Supports batch generation with configurable concurrency. |

### 2.4 User Memory (MongoDB)

| Aspect | Detail |
|---|---|
| **Role** | Persistent storage for user preferences, interaction history, full reasoning JSON, and feedback records |
| **Collections** | `userpreferences` — tone, sign-off, signature, avoidPhrases, styleNotes; `interactionlogs` — timestamped request/outcome records plus nested reasoning payload (TTL-indexed); `feedbackrecords` — extracted preference changes for audit; `meetings` — calendar events linked to leads |
| **Key behavior** | Read/write through service/agent classes. Preferences are loaded at the start of each orchestration cycle. Interaction logs now store `plan`, `rawPlan`, `taskBreakdown`, `agentsPlanned`, full `reasoningTrace`, `decisions`, `confidence`, `usage`, and timing. A two-phase `MemoryExtractor` (rule-based + LLM fallback) parses natural-language feedback into structured `MemoryUpdate` objects. |

### 2.5 Calendar Agent

| Aspect | Detail |
|---|---|
| **Role** | Creates, lists, and deletes meetings linked to leads |
| **Input** | `CreateMeetingInput`, `ListMeetingsQuery`, or meeting id |
| **Output** | `Meeting` objects with `title`, `leadId`, `startTime`, and `endTime` |
| **Key behavior** | Prevents scheduling conflicts using the rule `new.start < existing.end && new.end > existing.start`. Can be used directly via REST or orchestrated through the Thinker. |

### 2.6 LLM Provider Abstraction

| Aspect | Detail |
|---|---|
| **Role** | Provider-agnostic interface for text generation |
| **Interface** | `ILLMProvider` — `generate()`, `modelName`, `pricing` |
| **Implementations** | `OpenAIProvider` (production), `MockLLMProvider` (tests) |
| **Key behavior** | Returns `LLMGenerateResult` with text, duration, and token usage. Pricing metadata enables cost estimation by the Thinker. Swappable without touching agent code. |

---

## 3. Data Flow

### Typical request: *"Write a cold email to fintech leads in NYC"*

```
User Request (CLI or REST API)
     │
     ▼
┌──────────────────────────────────────┐
│  THINKER AGENT                       │
│                                      │
│  Step 1: Load user preferences       │
│    → MemoryService.getPreferences()  │
│    → {tone, signOff, avoidPhrases}   │
│                                      │
│  Step 2: Analyze & plan via LLM      │
│    → intent: "fetch_and_email"       │
│    → entities: {industry: "fintech", │
│       location: "NYC"}              │
│    → confidence: 0.95                │
│                                      │
│  Step 3: Execute plan                │
│    ├─► LeadAgent.execute(            │
│    │     {industry, location})       │
│    │     └─► [lead1, lead2, …]       │
│    │                                 │
│    └─► WriterAgent.execute(          │
│          lead, prefs) × N            │
│          └─► [email1, email2, …]     │
│                                      │
│  Step 4: Aggregate & return          │
│    → reasoning_trace + emails +      │
│      confidence + cost + decisions   │
└──────────────────────────────────────┘
     │
     ▼
  ThinkingResult → API Response / CLI Output
```

### Typical request: *"Schedule a meeting with John tomorrow at 3pm"*

```
User Request (UI / CLI / API)
     │
     ▼
┌──────────────────────────────────────┐
│  THINKER AGENT                       │
│                                      │
│  Step 1: Load preferences            │
│  Step 2: Plan via LLM                │
│    → intent: "schedule_meeting"     │
│    → entities: {contactName: John}   │
│    → agents: [lead_agent,            │
│                calendar_agent]       │
│                                      │
│  Step 3: Resolve target lead         │
│    └─► LeadAgent.execute(...)        │
│                                      │
│  Step 4: Create meeting              │
│    └─► CalendarAgent.createMeeting() │
│         └─► overlap check            │
│         └─► insert meeting           │
│                                      │
│  Step 5: Return trace + payload      │
└──────────────────────────────────────┘
```

### Agent communication protocol

All agents communicate via **typed TypeScript interfaces** — never `any` or untyped objects. The Thinker calls agents via their `execute()` method (returning typed results). No message bus is needed at this scale.

```typescript
// Thinker calls Lead Agent
const leadResult = await this.leadAgent.execute({
  query: { industry: "fintech", location: "NYC", limit: 5 },
});

// Thinker calls Writer Agent
const writerResult = await this.writerAgent.execute({
  lead: leadResult.leads[0],
  preferences: userPrefs,
  emailType: "first_outreach",
});

// Thinker calls Calendar Agent
const meeting = await this.calendarAgent.createMeeting({
  title: "Call with John from Apple",
  leadId: leadResult.leads[0].id,
  startTime: new Date("2026-04-22T15:00:00.000Z"),
  endTime: new Date("2026-04-22T15:30:00.000Z"),
});
```

---

## 4. API Layer

The Express 5 API exposes the system over HTTP with the following endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/query` | Process a natural-language request (sync) |
| POST | `/api/query/stream` | Process with SSE streaming (step-by-step events) |
| GET/POST/PUT/DELETE | `/api/leads` | CRUD operations on leads (field-whitelisted) |
| GET/POST/DELETE | `/api/meetings` | Meeting management with conflict protection |
| GET/POST/PUT | `/api/preferences` | Manage user email preferences |
| GET/DELETE | `/api/memory` | View or clear interaction history and feedback |
| GET | `/api/analytics` | Dashboard stats (queries, pipeline, feedback) |

**Security features:** CORS enabled, field whitelisting on mutation endpoints (mass assignment protection), configurable request timeout (default 60s), graceful shutdown (SIGTERM/SIGINT).

---

## 5. Key Design Decisions I made for building this system.

### Decision 1: Orchestrator Pattern (not autonomous agents)

**Choice:** The Thinker explicitly plans and calls agents in sequence — agents do not call each other.

**Why:** Predictable control flow, easy to debug and trace. Autonomous agent-to-agent communication adds complexity without value at this scale. The Thinker acts as a single point of coordination.

**Trade-off:** Less flexible than a fully autonomous swarm, but far more reliable and debuggable.

---

### Decision 2: Structured Reasoning Trace (not chain-of-thought in prompt)

**Choice:** The Thinker produces a `ReasoningStep[]` array as structured output, not free-text chain-of-thought.

**Why:** Machine-parseable traces enable logging, testing, and UI rendering. You can assert on reasoning in tests (`expect(trace[0].action).toBe("load_preferences")`). Free-text CoT is fragile and hard to validate.

```typescript
interface ReasoningStep {
  step: number;
  thought: string;      // what the agent is thinking
  action: string;       // the action being taken
  agent: string | null; // which sub-agent is called
  inputSummary: string; // what was sent
  resultSummary: string;// brief summary of what came back
  status: "success" | "skipped" | "error";
  durationMs?: number;
}
```

---

### Decision 3: MongoDB for all persistent data

**Choice:** Single MongoDB instance with separate collections for leads, meetings, user preferences, interaction logs, and feedback records.

**Why:** MongoDB's flexible schema fits both structured lead records and evolving preference documents. Mongoose provides schema validation, indexes, and lean queries. TTL indexes on logs handle automatic cleanup.

**Collections:**
- `leads` — company, contact, dealStage, industry, companySize, priority, tags
- `meetings` — title, leadId, startTime, endTime
- `userpreferences` — tone, signature, signOff, avoidPhrases, styleNotes
- `interactionlogs` — timestamped request/outcome history + persisted reasoning JSON (90-day TTL)
- `feedbackrecords` — extracted preference changes for audit trail (180-day TTL)

---

### Decision 4: Agents as Classes with a Common Interface

**Choice:** Each agent extends a `BaseAgent<TInput, TResult>` abstract class with `name`, `description`, and a typed `execute()` method.

**Why:** Enables the Thinker to call agents polymorphically. This is what made the Calendar Agent a natural extension of the system without changing the overall architecture.

```typescript
abstract class BaseAgent<TInput, TResult extends AgentResult> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract execute(input: TInput): Promise<TResult>;
}
```

---

### Decision 5: No Framework (LangChain, CrewAI, etc.)

**Choice:** Pure TypeScript + OpenAI SDK + Mongoose.

**Why:** Frameworks add abstraction layers that obscure control flow — exactly what you don't want in a system where traceability is a requirement. Direct API calls are easier to debug and more transparent. For 4 agents, the overhead of a framework still isn't justified.

**Trade-off:** You write ~50 more lines of glue code, but gain full control over every LLM call, retry, and routing decision.

---

### Decision 6: LLM Provider Abstraction

**Choice:** All LLM calls go through the `ILLMProvider` interface. No agent imports the OpenAI SDK directly.

**Why:** Enables swapping providers (OpenAI → Anthropic → local model) by implementing a single interface. The `MockLLMProvider` makes unit tests fast and deterministic with zero API calls. Token usage and pricing are tracked per-provider for cost estimation.

---

### Decision 7: Two-Phase Memory Extraction

**Choice:** The `MemoryExtractor` uses rule-based regex matching first, falling back to LLM extraction only when rules produce nothing.

**Why:** Rules are fast, deterministic, and high-confidence (1.0). LLM fallback catches nuanced signals that regex misses, at lower confidence (0.6–0.9). This hybrid approach minimises API costs while maximising coverage.

---

### Decision 8: Persisted Reasoning JSON

**Choice:** Store a nested reasoning payload inside each `interactionlogs` document instead of only returning the trace to the client.

**Why:** This enables historical debugging, richer UI inspection, and auditing of how the Thinker classified intent, broke the task into steps, chose agents, and executed the request.

The stored reasoning payload includes:
- `plan`
- `rawPlan`
- `taskBreakdown`
- `agentsPlanned`
- `entities`
- `leadQuery`
- `emailType`
- full `reasoningTrace`
- `decisions`
- `confidence`
- `usage`
- `totalDurationMs`

## 6. Project Structure

```
AI_Assistant/
├── ARCHITECTURE.md
├── README.md
├── package.json
├── tsconfig.json
├── jest.config.ts
├── .env.example
├── .gitignore
│
├── src/
│   ├── index.ts                           # CLI entry point
│   ├── config/
│   │   └── env.ts                         # Environment config (dotenv)
│   │
│   ├── agents/
│   │   ├── base.agent.ts                  # BaseAgent<TInput, TResult>
│   │   ├── calendar.agent.ts              # Meeting create/list/delete + conflict checks
│   │   ├── lead.agent.ts                  # Lead retrieval agent
│   │   ├── writer.agent.ts                # LLM-powered email writer
│   │   └── index.ts
│   │
│   ├── orchestration/
│   │   ├── thinker.agent.ts               # Thinker orchestrator
│   │   └── index.ts
│   │
│   ├── services/
│   │   ├── index.ts                       # Service barrel exports
│   │   ├── lead.service.ts                # MongoDB lead data-access layer
│   │   ├── email.service.ts               # Batch email generation with concurrency
│   │   ├── email.prompts.ts               # Email template prompts per type
│   │   ├── llm.provider.ts                # ILLMProvider + OpenAI + Mock impls
│   │   ├── memory.service.ts              # User preferences + interaction CRUD
│   │   └── memory.extractor.ts            # Rule-based + LLM preference extraction
│   │
│   ├── database/
│   │   ├── index.ts                       # connectDB, closeDB, model exports
│   │   ├── connection.ts                  # Mongoose connection manager
│   │   ├── schemas/                       # Mongoose schema definitions
│   │   │   ├── lead.schema.ts
│   │   │   ├── meeting.schema.ts
│   │   │   ├── memory.schema.ts
│   │   │   └── index.ts
│   │   └── seed.ts                        # 20 sample leads seeder
│   │
│   ├── api/
│   │   ├── server.ts                      # Express 5 app (CORS, shutdown, timeout)
│   │   └── routes/
│   │       ├── query.routes.ts            # POST /query + POST /query/stream (SSE)
│   │       ├── leads.routes.ts            # CRUD with field whitelisting
│   │       ├── meetings.routes.ts         # Meeting CRUD with conflict handling
│   │       ├── preferences.routes.ts      # Preferences CRUD with sanitisation
│   │       ├── memory.routes.ts           # Interaction history & feedback
│   │       └── analytics.routes.ts        # Dashboard aggregations
│   │
│   ├── types/
│   │   ├── index.ts                       # Barrel re-export
│   │   ├── lead.types.ts                  # Lead, LeadQuery, DealStage, etc.
│   │   ├── email.types.ts                 # EmailRequest, EmailDraft, EmailType
│   │   ├── meeting.types.ts               # Meeting and calendar input types
│   │   ├── memory.types.ts                # UserPreferences, MemoryUpdate, etc.
│   │   ├── reasoning.types.ts             # PlannerOutput, ThinkingResult, etc.
│   │   └── agent.types.ts                 # Base agent interfaces
│   │
│   └── utils/
│       ├── printer.ts                     # CLI reasoning/result renderer
│       └── index.ts
│
├── public/
│   └── index.html                         # Browser UI: chat, leads, meetings, prefs, analytics, memory
│
├── tests/
│   ├── memory.extractor.test.ts           # Rule + LLM extraction tests
│   ├── lead.service.test.ts               # Data-access layer tests (mocked Mongoose)
│   └── thinker.agent.test.ts              # Orchestration integration tests
│
└── examples/                              # Optional reference examples
```

---

## 7. Technology Choices

| Component | Technology | Justification |
|---|---|---|
| Language | TypeScript 5.7 (strict) | Type safety, excellent IDE support, large ecosystem |
| Runtime | Node.js | Non-blocking I/O, shared language with frontend |
| LLM | OpenAI GPT-4o-mini | Cost effective ($0.15/1M input), fast, reliable JSON output |
| Database | MongoDB (via Mongoose 9) | Flexible schema, lean queries, TTL indexes, aggregation pipeline |
| API | Express 5 | Lightweight, battle-tested, async handler support |
| Testing | Jest + ts-jest | Standard TS testing stack, mock-friendly |

---

## 8. Extensibility Path

The architecture supports adding new agents without modifying existing code:

1. **Create a new agent class** extending `BaseAgent<TInput, TResult>`
2. **Define input/output TypeScript interfaces** in `src/types/`
3. **Wire it into the Thinker** constructor via dependency injection
4. **Update the Thinker's routing prompt** to include the new agent's description

Example future agents:
- **Research Agent** — enriches leads with web data
- **Analytics Agent** — reports on email open rates and pipeline metrics
- **Slack Agent** — sends notifications and receives commands via Slack
