/**
 * POST /api/query — NL query → ThinkerAgent → response + reasoning trace
 * POST /api/query/stream — SSE stream with live reasoning steps
 */

import { Router } from "express";
import { ThinkerAgent } from "../../orchestration/thinker.agent";
import { asyncHandler } from "../middleware";

export function createQueryRouter(thinker: ThinkerAgent, timeoutMs = 60_000): Router {
  const router = Router();

  /**
   * POST /api/query
   * Body: { "message": "...", "userId": "..." }
   * → { response, reasoningTrace, plan, data, confidence, usage, meta }
   */
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { message, userId } = req.body;

      if (!message || typeof message !== "string") {
        res.status(400).json({
          status: 400,
          error: "Bad Request",
          message: '"message" is required and must be a string.',
        });
        return;
      }

      // Race ThinkerAgent against a timeout
      const process = thinker.process(message, userId ?? "default_user");
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Query timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      const result = await Promise.race([process, timeout]);

      res.json({
        success: result.success,
        response: result.finalResponse,
        reasoningTrace: result.reasoningTrace,
        plan: result.plan,
        data: result.data ?? null,
        confidence: result.confidence,
        decisions: result.decisions ?? [],
        usage: result.usage ?? null,
        rawPlan: result.rawPlan ?? null,
        meta: {
          totalDurationMs: result.totalDurationMs,
          timestamp: result.timestamp,
        },
      });
    })
  );

  /**
   * POST /api/query/stream
   * Body: { "message": "...", "userId": "..." }
   * Returns SSE stream with reasoning steps as they complete.
   */
  router.post(
    "/stream",
    asyncHandler(async (req, res) => {
      const { message, userId } = req.body;

      if (!message || typeof message !== "string") {
        res.status(400).json({
          status: 400,
          error: "Bad Request",
          message: '"message" is required and must be a string.',
        });
        return;
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Send a heartbeat to confirm connection
      res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

      // Process the query (non-streaming — we'll stream the full trace after)
      const result = await thinker.process(message, userId ?? "default_user");

      // Stream each reasoning step individually
      for (const step of result.reasoningTrace) {
        res.write(`data: ${JSON.stringify({ type: "step", step })}\n\n`);
      }

      // Send the final result
      res.write(
        `data: ${JSON.stringify({
          type: "result",
          success: result.success,
          response: result.finalResponse,
          plan: result.plan,
          rawPlan: result.rawPlan ?? null,
          data: result.data ?? null,
          confidence: result.confidence,
          decisions: result.decisions ?? [],
          usage: result.usage ?? null,
          totalDurationMs: result.totalDurationMs,
        })}\n\n`
      );

      // Close the stream
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    })
  );

  return router;
}
