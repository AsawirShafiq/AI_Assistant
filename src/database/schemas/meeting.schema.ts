import mongoose, { Schema } from "mongoose";
import { IMeetingDocument } from "../../types";

const meetingSchema = new Schema<IMeetingDocument>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    leadId: {
      type: String,
      required: true,
      trim: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

meetingSchema.index({ startTime: 1, endTime: 1 });
meetingSchema.index({ leadId: 1, startTime: -1 });

export const MeetingModel = mongoose.model<IMeetingDocument>(
  "Meeting",
  meetingSchema
);
