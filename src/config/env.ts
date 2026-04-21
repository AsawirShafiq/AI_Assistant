import dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  mongodbUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017",
  mongodbDbName: process.env.MONGODB_DB_NAME ?? "crm_assistant",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;
