/**
 * Shared API middleware — error handling & async wrapper.
 */

import { Request, Response, NextFunction } from "express";

// ─── Async Route Wrapper ─────────────────────────────────

/**
 * Wraps an async Express handler so thrown errors are forwarded
 * to the global error handler instead of crashing the process.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// ─── Error Response Shape ────────────────────────────────

interface ApiError {
  status: number;
  error: string;
  message: string;
  details?: unknown;
}

// ─── Global Error Handler ────────────────────────────────

export function errorHandler(
  err: Error & { status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.status ?? 500;
  const body: ApiError = {
    status,
    error: status === 500 ? "Internal Server Error" : "Bad Request",
    message: err.message || "An unexpected error occurred",
  };

  if (process.env.NODE_ENV !== "production" && status === 500) {
    body.details = err.stack;
  }

  console.error(`[API] ${status} — ${err.message}`);
  res.status(status).json(body);
}

// ─── 404 Handler ─────────────────────────────────────────

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    status: 404,
    error: "Not Found",
    message: `Route ${_req.method} ${_req.originalUrl} not found`,
  });
}
