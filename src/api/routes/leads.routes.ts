/**
 * /api/leads — CRUD routes for lead management
 */

import { Router } from "express";
import { LeadModel } from "../../database";
import { LeadService } from "../../services/lead.service";
import { ILeadDocument } from "../../types";
import { asyncHandler } from "../middleware";

/** Fields allowed for lead creation — prevents mass assignment. */
const CREATABLE_FIELDS = [
  "company", "contactName", "contactEmail", "contactPhone", "contactTitle",
  "industry", "location", "dealStage", "companySize", "estimatedValue",
  "source", "priority", "tags", "notes", "nextFollowUp",
] as const;

/** Fields allowed for lead updates — prevents overwriting _id, createdAt, etc. */
const UPDATABLE_FIELDS = [
  "company", "contactName", "contactEmail", "contactPhone", "contactTitle",
  "industry", "location", "dealStage", "companySize", "estimatedValue",
  "source", "priority", "tags", "notes", "nextFollowUp", "lastContactedAt",
] as const;

/** Pick only allowed keys from a request body. */
function pickFields<T extends string>(
  body: Record<string, unknown>,
  allowed: readonly T[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) result[key] = body[key];
  }
  return result;
}

export function createLeadsRouter(): Router {
  const router = Router();
  const leadService = new LeadService();

  // ── GET /api/leads ──────────────────────────────────────
  // Query params: name, company, industry, location, dealStage,
  //   companySize, search, limit, skip, sortBy, sortOrder
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const q = req.query;
      const query = {
        name: str(q.name),
        company: str(q.company),
        industry: str(q.industry),
        location: str(q.location),
        dealStage: str(q.dealStage) as any,
        companySize: str(q.companySize) as any,
        search: str(q.search),
        limit: num(q.limit, 20),
        skip: num(q.skip, 0),
        sortBy: str(q.sortBy) as any,
        sortOrder: str(q.sortOrder) as any,
      };

      // Strip undefined values
      const cleaned = Object.fromEntries(
        Object.entries(query).filter(([, v]) => v !== undefined)
      );

      const result = await leadService.findMany(cleaned);
      res.json({
        leads: result.leads,
        totalCount: result.totalCount,
        limit: query.limit,
        skip: query.skip ?? 0,
      });
    })
  );

  // ── GET /api/leads/:id ──────────────────────────────────
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      const lead = await leadService.findById(id);
      if (!lead) {
        res.status(404).json({
          status: 404,
          error: "Not Found",
          message: `Lead ${id} not found`,
        });
        return;
      }
      res.json(lead);
    })
  );

  // ── POST /api/leads ─────────────────────────────────────
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { company, contactName, contactEmail, industry, location } =
        req.body;

      if (!company || !contactName || !contactEmail || !industry || !location) {
        res.status(400).json({
          status: 400,
          error: "Bad Request",
          message:
            "Required fields: company, contactName, contactEmail, industry, location",
        });
        return;
      }

      const doc = await LeadModel.create(pickFields(req.body, CREATABLE_FIELDS));
      res.status(201).json(LeadService.toPlainLead(doc as unknown as ILeadDocument));
    })
  );

  // ── PUT /api/leads/:id ──────────────────────────────────
  router.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      const sanitized = pickFields(req.body, UPDATABLE_FIELDS);
      const doc = await LeadModel.findByIdAndUpdate(
        id,
        { $set: sanitized },
        { new: true, runValidators: true }
      )
        .lean<ILeadDocument>()
        .exec();

      if (!doc) {
        res.status(404).json({
          status: 404,
          error: "Not Found",
          message: `Lead ${id} not found`,
        });
        return;
      }
      res.json(LeadService.toPlainLead(doc));
    })
  );

  // ── DELETE /api/leads/:id ───────────────────────────────
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      const doc = await LeadModel.findByIdAndDelete(id).exec();
      if (!doc) {
        res.status(404).json({
          status: 404,
          error: "Not Found",
          message: `Lead ${id} not found`,
        });
        return;
      }
      res.json({ message: `Lead ${id} deleted` });
    })
  );

  return router;
}

// ─── Helpers ─────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
