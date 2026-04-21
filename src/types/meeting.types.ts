import { Document, Types } from "mongoose";

export interface Meeting {
  id: string;
  title: string;
  leadId: string;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMeetingDocument extends Omit<Meeting, "id">, Document {
  _id: Types.ObjectId;
}

export interface CreateMeetingInput {
  title: string;
  leadId: string;
  startTime: Date;
  endTime: Date;
}

export interface ListMeetingsQuery {
  leadId?: string;
  title?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}
