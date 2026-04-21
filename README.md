# Multi-Agent CRM AI Assistant

A modular, multi-agent system that acts as a CRM sales assistant. An LLM-powered **Thinker** orchestrator routes user requests to specialized agents — **Lead Agent** (data retrieval), **Writer Agent** (email generation), and **Calendar Agent** (meeting management) — while maintaining persistent **User Memory** in MongoDB.

Every decision is logged as an explicit, structured **reasoning trace** with confidence scoring, cost tracking, and a persisted reasoning JSON payload for auditability.

Includes a built-in **dark-themed web UI** to interact with every feature — chat, leads, meetings, preferences, analytics, and memory — directly from the browser.

**Stack:** Node.js · TypeScript · OpenAI · MongoDB · Express

---

## Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **MongoDB** running locally (default `mongodb://localhost:27017`) or a remote URI
- An **OpenAI API key**

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set these values at minimum:
#   OPENAI_API_KEY=sk-...
#   MONGODB_URI=mongodb://localhost:27017
#   MONGODB_DB_NAME=crm_assistant

# 3. Seed the database with 20 sample leads
npm run seed

# 4. Start the server (API + UI)
npm run api
```

Open **http://localhost:3000** in your browser — the full UI loads automatically.

---

## Web UI

The project ships with a single-page dashboard at `public/index.html`, served automatically when the API starts. Navigate between sections using the sidebar:

### AI Chat

Ask the assistant anything in natural language. Queries are streamed via SSE so you see each reasoning step in real time.

**Try these prompts:**

```
Show me fintech leads in New York
Write cold emails to SaaS startup leads
Draft a follow-up email to HealthSync
Make the tone more casual
Don't say "synergy" in emails
```

Each response includes:
- **Planning & Intent panel** — shows detected intent, task breakdown, entity extraction, lead filters, and agent routing
- **Reasoning trace** — expand to see every step the orchestrator took
- **Confidence score** — how certain the AI is about the result
- **Cost & duration** — token usage and response time
- **Decisions log** — every routing/filtering choice explained

### Leads

Browse, search, and filter the leads database. Filter by industry, location, deal stage, or company size. Each lead card shows company info, contact details, priority, deal value, and tags.

### Meetings

Manage sales meetings directly from the UI:
- Create a meeting linked to a lead
- Prevent overlapping meetings automatically
- View all scheduled meetings
- Delete/cancel meetings

The Calendar Agent powers this workflow and enforces conflict detection using:

`new.start < existing.end && new.end > existing.start`

### Preferences

Configure how the AI writes emails for you:
- Tone (professional, casual, formal, etc.)
- Preferred length (short, medium, long)
- Sender name, title, company
- Sign-off and signature
- Phrases to avoid (e.g., "synergy", "leverage")
- Style notes (e.g., "always include a CTA")

Changes persist per user and are applied automatically to all future emails.

### Analytics

Dashboard with stats for the last 30 days:
- Total queries and feedback count
- Intent distribution chart (fetch leads, write email, schedule meeting, etc.)
- Lead pipeline breakdown by deal stage
- Recent activity timeline

### Memory

Inspect the AI's memory for your user:
- Current preference snapshot
- Full feedback history showing what you changed and when
- **Clear Memory** button to reset interaction history

---

## Using the System

### Step-by-step walkthrough

1. **Start the server** — `npm run api` (seeds the DB on first run if needed)
2. **Open the UI** — go to http://localhost:3000
3. **Set your User ID** — type a name in the top-right field (defaults to `default_user`)
4. **Chat with the AI** — ask it to find leads, write emails, schedule meetings, or summarize data
5. **Manage meetings** — use the Meetings tab to create, inspect, and delete meetings
6. **Refine preferences** — tell the AI "make it more casual" or go to the Preferences tab
7. **Check analytics** — switch to the Analytics tab to see your query history
8. **Inspect memory** — the Memory tab shows what the AI remembers about you

### CLI mode

For terminal-only usage without the browser:

```bash
npm run dev
```

This starts an interactive REPL where you type queries and see results inline.

### API mode (programmatic)

All features are available via REST endpoints:

```bash
# Sync query
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me fintech leads in NYC", "userId": "user1"}'

# SSE streaming (step-by-step reasoning)
curl -X POST http://localhost:3000/api/query/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "Write cold emails to SaaS leads", "userId": "user1"}'

# List leads with filters
curl "http://localhost:3000/api/leads?industry=fintech&location=NYC&limit=10"

# Create a meeting
curl -X POST http://localhost:3000/api/meetings \
  -H "Content-Type: application/json" \
  -d '{"title":"Call with John from Apple","leadId":"<leadId>","startTime":"2026-04-22T15:00:00.000Z","endTime":"2026-04-22T15:30:00.000Z"}'

# List meetings
curl "http://localhost:3000/api/meetings?limit=20"

# Delete a meeting
curl -X DELETE http://localhost:3000/api/meetings/<meetingId>

# Get/update preferences
curl http://localhost:3000/api/preferences?userId=user1
curl -X PUT "http://localhost:3000/api/preferences?userId=user1" \
  -H "Content-Type: application/json" \
  -d '{"tone": "casual", "avoidPhrases": ["synergy"]}'

# Analytics
curl "http://localhost:3000/api/analytics?userId=user1&days=30"

# Memory snapshot
curl "http://localhost:3000/api/memory?userId=user1"

# Health check
curl http://localhost:3000/api/health
```

---

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design, component diagrams, and design decisions.

### Key Components

| Component | File | Purpose |
|---|---|---|
| Thinker Agent | `src/orchestration/thinker.agent.ts` | Orchestrates everything — plans, routes, traces |
| Lead Agent | `src/agents/lead.agent.ts` | Queries MongoDB for leads |
| Writer Agent | `src/agents/writer.agent.ts` | OpenAI-powered email generation |
| Calendar Agent | `src/agents/calendar.agent.ts` | Creates, lists, and deletes meetings with conflict prevention |
| LLM Provider | `src/services/llm.provider.ts` | Provider-agnostic LLM abstraction |
| Memory Service | `src/services/memory.service.ts` | Persists user preferences + interaction history |
| Memory Extractor | `src/services/memory.extractor.ts` | Rule-based + LLM preference extraction |
| API Server | `src/api/server.ts` | Express 5 REST API with SSE streaming |
| Web UI | `public/index.html` | Single-page dashboard for all features |
| Types | `src/types/` | TypeScript interfaces for all data models |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run the CLI assistant (via ts-node) |
| `npm run api` | Start the REST API server + UI |
| `npm run seed` | Seed MongoDB with 20 sample leads |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run the compiled build |
| `npm test` | Run tests (52 tests across 3 suites) |
| `npm run lint` | Lint source code |
