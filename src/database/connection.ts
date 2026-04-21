import mongoose from "mongoose";
import { config } from "../config/env";

/**
 * Connect to MongoDB via Mongoose.
 * Reuses the existing connection if already established.
 */
export async function connectDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const uri = `${config.mongodbUri}/${config.mongodbDbName}`;
  await mongoose.connect(uri);

  console.log(`[db] Connected to ${config.mongodbDbName}`);
  return mongoose;
}

/** Gracefully close the Mongoose connection. */
export async function closeDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("[db] Connection closed");
  }
}
