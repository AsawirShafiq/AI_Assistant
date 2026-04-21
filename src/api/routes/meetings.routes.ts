import { Router } from "express";
import { CalendarAgent, CalendarConflictError } from "../../agents";
import { asyncHandler } from "../middleware";

export function createMeetingsRouter(calendar: CalendarAgent): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const meetings = await calendar.listMeetings({
        leadId: str(req.query.leadId),
        title: str(req.query.title),
        from: date(req.query.from),
        to: date(req.query.to),
        limit: num(req.query.limit, 50),
      });
      res.json({ meetings, totalCount: meetings.length });
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { title, leadId, startTime, endTime } = req.body as Record<string, unknown>;

      if (!title || !leadId || !startTime || !endTime) {
        res.status(400).json({
          status: 400,
          error: "Bad Request",
          message: "Required fields: title, leadId, startTime, endTime",
        });
        return;
      }

      try {
        const meeting = await calendar.createMeeting({
          title: String(title),
          leadId: String(leadId),
          startTime: new Date(String(startTime)),
          endTime: new Date(String(endTime)),
        });
        res.status(201).json(meeting);
      } catch (err) {
        if (err instanceof CalendarConflictError) {
          res.status(409).json({
            status: 409,
            error: "Conflict",
            message: err.message,
          });
          return;
        }
        throw err;
      }
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const deleted = await calendar.deleteMeeting(id);
      if (!deleted) {
        res.status(404).json({
          status: 404,
          error: "Not Found",
          message: `Meeting ${id} not found`,
        });
        return;
      }

      res.json({ message: `Meeting ${id} deleted` });
    })
  );

  return router;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function date(v: unknown): Date | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
