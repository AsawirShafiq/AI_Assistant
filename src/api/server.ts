

import path from "path";
import express from "express";
import cors from "cors";
import { config } from "../config/env";
import { connectDB, closeDB } from "../database";
import { OpenAIProvider } from "../services/llm.provider";
import { MemoryService } from "../services/memory.service";
import { ThinkerAgent } from "../orchestration/thinker.agent";
import { CalendarAgent } from "../agents/calendar.agent";
import { LeadAgent } from "../agents/lead.agent";
import { WriterAgent } from "../agents/writer.agent";

import { createQueryRouter } from "./routes/query.routes";
import { createLeadsRouter } from "./routes/leads.routes";
import { createMeetingsRouter } from "./routes/meetings.routes";
import { createMemoryRouter } from "./routes/memory.routes";
import { createPreferencesRouter } from "./routes/preferences.routes";
import { createAnalyticsRouter } from "./routes/analytics.routes";
import { errorHandler, notFoundHandler } from "./middleware";

// ─── Bootstrap ───────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // 1. Connect to MongoDB
  await connectDB();
  console.log("[api] MongoDB connected");

  // 2. Build shared dependencies
  const llm = new OpenAIProvider(config.openaiApiKey, config.openaiModel);
  const memory = new MemoryService(llm);
  const calendarAgent = new CalendarAgent();
  const leadAgent = new LeadAgent();
  const writerAgent = new WriterAgent(llm);
  const thinker = new ThinkerAgent({
    llmProvider: llm,
    calendarAgent,
    leadAgent,
    writerAgent,
    memoryService: memory,
  });

  // 3. Create Express app
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve the showcase UI from /public
  app.use(express.static(path.join(__dirname, "../../public")));

  // Request timeout for LLM-heavy routes
  const QUERY_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS) || 60_000;

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Mount route modules
  app.use("/api/query", createQueryRouter(thinker, QUERY_TIMEOUT_MS));
  app.use("/api/leads", createLeadsRouter());
  app.use("/api/meetings", createMeetingsRouter(calendarAgent));
  app.use("/api/memory", createMemoryRouter(memory));
  app.use("/api/preferences", createPreferencesRouter(memory));
  app.use("/api/analytics", createAnalyticsRouter());

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  // 4. Start
  const PORT = process.env.PORT ?? 3000;
  const server = app.listen(PORT, () => {
    console.log(`[api] Server running → http://localhost:${PORT}`);
    console.log(`[api] UI → http://localhost:${PORT}/`);
    console.log(`[api] Endpoints:`);
    console.log(`  POST   /api/query`);
    console.log(`  POST   /api/query/stream`);
    console.log(`  GET    /api/leads`);
    console.log(`  POST   /api/leads`);
    console.log(`  PUT    /api/leads/:id`);
    console.log(`  DELETE /api/leads/:id`);
    console.log(`  GET    /api/meetings`);
    console.log(`  POST   /api/meetings`);
    console.log(`  DELETE /api/meetings/:id`);
    console.log(`  GET    /api/memory`);
    console.log(`  DELETE /api/memory`);
    console.log(`  GET    /api/preferences`);
    console.log(`  POST   /api/preferences`);
    console.log(`  PUT    /api/preferences`);
    console.log(`  GET    /api/analytics`);
    console.log(`  GET    /api/health`);
  });

  // 5. Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[api] ${signal} received — shutting down gracefully...`);
    server.close(async () => {
      await closeDB();
      console.log("[api] Server closed. Goodbye!");
      process.exit(0);
    });
    // Force exit after 10s if server doesn't close cleanly
    setTimeout(() => {
      console.error("[api] Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  console.error("[api] Failed to start:", err);
  process.exit(1);
});
