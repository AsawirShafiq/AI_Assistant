/**
 * LeadService Tests
 *
 * Tests the data-access layer by mocking Mongoose models.
 * No real MongoDB connection needed.
 */

import { LeadService, LeadServiceError, PRIORITY_WEIGHT } from "../src/services/lead.service";
import { LeadModel } from "../src/database";
import { ILeadDocument, Lead, DealStage } from "../src/types";
import { Types } from "mongoose";

// ─── Mock the database module ────────────────────────────

jest.mock("../src/database", () => ({
  LeadModel: {
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
  },
}));

// ─── Helpers ─────────────────────────────────────────────

function makeFakeDoc(overrides: Partial<ILeadDocument> = {}): ILeadDocument {
  return {
    _id: new Types.ObjectId(),
    company: "Acme Corp",
    contactName: "John Doe",
    contactEmail: "john@acme.com",
    contactPhone: "+1-555-0100",
    contactTitle: "VP of Sales",
    industry: "Technology",
    location: "New York",
    dealStage: "prospecting" as DealStage,
    companySize: "mid-market",
    estimatedValue: 50000,
    source: "referral",
    priority: "medium",
    tags: ["saas"],
    notes: "Good prospect",
    lastContactedAt: new Date(),
    nextFollowUp: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as ILeadDocument;
}

/** Create a chainable mock that supports .sort().skip().limit().lean().exec() */
function chainableMock(docs: ILeadDocument[]) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(docs),
  };
  return chain;
}

function countMock(count: number) {
  return {
    exec: jest.fn().mockResolvedValue(count),
  };
}

// ─── Tests ───────────────────────────────────────────────

describe("LeadService", () => {
  let service: LeadService;

  beforeEach(() => {
    service = new LeadService();
    jest.clearAllMocks();
  });

  // ── toPlainLead ────────────────────────────────────────

  describe("toPlainLead", () => {
    it("converts a Mongoose document to a plain Lead object", () => {
      const doc = makeFakeDoc();
      const plain = LeadService.toPlainLead(doc);

      expect(plain.id).toBe(doc._id.toString());
      expect(plain.company).toBe("Acme Corp");
      expect(plain.contactName).toBe("John Doe");
      expect(plain.dealStage).toBe("prospecting");
      expect(plain.tags).toEqual(["saas"]);
      // Verify it's a plain object (no Mongoose internals)
      expect((plain as any)._id).toBeUndefined();
    });

    it("is a static method (callable without instance)", () => {
      expect(typeof LeadService.toPlainLead).toBe("function");
    });
  });

  // ── PRIORITY_WEIGHT ────────────────────────────────────

  describe("PRIORITY_WEIGHT", () => {
    it("assigns high > medium > low", () => {
      expect(PRIORITY_WEIGHT.high).toBeGreaterThan(PRIORITY_WEIGHT.medium);
      expect(PRIORITY_WEIGHT.medium).toBeGreaterThan(PRIORITY_WEIGHT.low);
    });

    it("has entries for all priority levels", () => {
      expect(PRIORITY_WEIGHT).toHaveProperty("high");
      expect(PRIORITY_WEIGHT).toHaveProperty("medium");
      expect(PRIORITY_WEIGHT).toHaveProperty("low");
    });
  });

  // ── findMany ───────────────────────────────────────────

  describe("findMany", () => {
    it("returns leads and totalCount", async () => {
      const docs = [makeFakeDoc(), makeFakeDoc({ company: "Beta Inc" })];
      (LeadModel.find as jest.Mock).mockReturnValue(chainableMock(docs));
      (LeadModel.countDocuments as jest.Mock).mockReturnValue(countMock(2));

      const result = await service.findMany({});

      expect(result.totalCount).toBe(2);
      expect(result.leads).toHaveLength(2);
      expect(result.leads[0]).toHaveProperty("id");
      expect(result.leads[0]).toHaveProperty("company");
    });

    it("passes string filters as case-insensitive regex", async () => {
      (LeadModel.find as jest.Mock).mockReturnValue(chainableMock([]));
      (LeadModel.countDocuments as jest.Mock).mockReturnValue(countMock(0));

      await service.findMany({ name: "John", company: "Acme" });

      const findCall = (LeadModel.find as jest.Mock).mock.calls[0][0];
      expect(findCall.contactName).toEqual({ $regex: "John", $options: "i" });
      expect(findCall.company).toEqual({ $regex: "Acme", $options: "i" });
    });

    it("passes enum filters as exact match", async () => {
      (LeadModel.find as jest.Mock).mockReturnValue(chainableMock([]));
      (LeadModel.countDocuments as jest.Mock).mockReturnValue(countMock(0));

      await service.findMany({ dealStage: "qualified", priority: "high" });

      const findCall = (LeadModel.find as jest.Mock).mock.calls[0][0];
      expect(findCall.dealStage).toBe("qualified");
      expect(findCall.priority).toBe("high");
    });

    it("applies default limit of 10", async () => {
      const chain = chainableMock([]);
      (LeadModel.find as jest.Mock).mockReturnValue(chain);
      (LeadModel.countDocuments as jest.Mock).mockReturnValue(countMock(0));

      await service.findMany({});

      expect(chain.limit).toHaveBeenCalledWith(10);
    });

    it("uses custom limit and skip", async () => {
      const chain = chainableMock([]);
      (LeadModel.find as jest.Mock).mockReturnValue(chain);
      (LeadModel.countDocuments as jest.Mock).mockReturnValue(countMock(0));

      await service.findMany({ limit: 5, skip: 10 });

      expect(chain.limit).toHaveBeenCalledWith(5);
      expect(chain.skip).toHaveBeenCalledWith(10);
    });

    it("wraps errors in LeadServiceError", async () => {
      (LeadModel.find as jest.Mock).mockReturnValue(
        chainableMock([])
      );
      (LeadModel.countDocuments as jest.Mock).mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error("DB down")),
      });

      await expect(service.findMany({})).rejects.toThrow(LeadServiceError);
    });
  });

  // ── findById ───────────────────────────────────────────

  describe("findById", () => {
    it("returns a lead when found", async () => {
      const doc = makeFakeDoc();
      (LeadModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(doc),
        }),
      });

      const result = await service.findById(doc._id.toString());
      expect(result).not.toBeNull();
      expect(result!.company).toBe("Acme Corp");
    });

    it("returns null when not found", async () => {
      (LeadModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      const result = await service.findById("nonexistent");
      expect(result).toBeNull();
    });
  });

  // ── getStageDistribution ───────────────────────────────

  describe("getStageDistribution", () => {
    it("returns counts per deal stage", async () => {
      (LeadModel.aggregate as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: "prospecting", count: 5 },
          { _id: "qualified", count: 3 },
          { _id: "closed_won", count: 2 },
        ]),
      });

      const dist = await service.getStageDistribution();

      expect(dist.prospecting).toBe(5);
      expect(dist.qualified).toBe(3);
      expect(dist.closed_won).toBe(2);
      // Unfilled stages default to 0
      expect(dist.proposal).toBe(0);
      expect(dist.negotiation).toBe(0);
      expect(dist.closed_lost).toBe(0);
    });
  });

  // ── Convenience finders ────────────────────────────────

  describe("convenience finders", () => {
    beforeEach(() => {
      (LeadModel.find as jest.Mock).mockReturnValue(chainableMock([]));
      (LeadModel.countDocuments as jest.Mock).mockReturnValue(countMock(0));
    });

    it("findByName delegates to findMany with name filter", async () => {
      const spy = jest.spyOn(service, "findMany");
      await service.findByName("John");
      expect(spy).toHaveBeenCalledWith({ name: "John", limit: 10 });
    });

    it("findByCompany delegates to findMany with company filter", async () => {
      const spy = jest.spyOn(service, "findMany");
      await service.findByCompany("Acme");
      expect(spy).toHaveBeenCalledWith({ company: "Acme", limit: 10 });
    });

    it("findByStage delegates to findMany with dealStage filter", async () => {
      const spy = jest.spyOn(service, "findMany");
      await service.findByStage("qualified");
      expect(spy).toHaveBeenCalledWith({ dealStage: "qualified", limit: 10 });
    });
  });
});
