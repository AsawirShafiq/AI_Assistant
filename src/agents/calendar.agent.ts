import { BaseAgent } from "./base.agent";
import { MeetingModel } from "../database";
import {
  CreateMeetingInput,
  IMeetingDocument,
  ListMeetingsQuery,
  Meeting,
} from "../types";

export class CalendarConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarConflictError";
  }
}

export class CalendarAgent extends BaseAgent<CreateMeetingInput, Meeting> {
  readonly name = "calendar_agent";
  readonly description =
    "Manages meetings: create, list, and delete while preventing time conflicts.";

  async execute(input: CreateMeetingInput): Promise<Meeting> {
    return this.createMeeting(input);
  }

  async createMeeting(input: CreateMeetingInput): Promise<Meeting> {
    const start = new Date(input.startTime);
    const end = new Date(input.endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Invalid meeting time. startTime and endTime must be valid dates.");
    }
    if (end <= start) {
      throw new Error("Invalid meeting range. endTime must be after startTime.");
    }

    const overlap = await MeetingModel.findOne({
      startTime: { $lt: end },
      endTime: { $gt: start },
    })
      .lean<IMeetingDocument>()
      .exec();

    if (overlap) {
      throw new CalendarConflictError(
        `Scheduling conflict: overlaps with \"${overlap.title}\" ` +
          `(${new Date(overlap.startTime).toISOString()} → ${new Date(overlap.endTime).toISOString()}).`
      );
    }

    const doc = await MeetingModel.create({
      title: input.title,
      leadId: input.leadId,
      startTime: start,
      endTime: end,
    });

    return CalendarAgent.toPlainMeeting(doc as unknown as IMeetingDocument);
  }

  async listMeetings(query: ListMeetingsQuery = {}): Promise<Meeting[]> {
    const filter: Record<string, unknown> = {};

    if (query.leadId) filter.leadId = query.leadId;
    if (query.title) filter.title = { $regex: query.title, $options: "i" };

    if (query.from || query.to) {
      const timeFilter: Record<string, Date> = {};
      if (query.from) timeFilter.$gte = query.from;
      if (query.to) timeFilter.$lte = query.to;
      filter.startTime = timeFilter;
    }

    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

    const docs = await MeetingModel.find(filter)
      .sort({ startTime: 1 })
      .limit(limit)
      .lean<IMeetingDocument[]>()
      .exec();

    return docs.map((doc) => CalendarAgent.toPlainMeeting(doc));
  }

  async deleteMeeting(id: string): Promise<boolean> {
    const doc = await MeetingModel.findByIdAndDelete(id).exec();
    return Boolean(doc);
  }

  static toPlainMeeting(doc: IMeetingDocument): Meeting {
    return {
      id: String(doc._id),
      title: doc.title,
      leadId: doc.leadId,
      startTime: doc.startTime,
      endTime: doc.endTime,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
