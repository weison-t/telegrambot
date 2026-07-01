import { config } from "dotenv";

// Load .env.local first (Next.js convention), then .env as fallback.
// dotenv does not override already-set vars, so .env.local wins.
config({ path: ".env.local" });
config();

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const env = {
  telegramApiId: () => parseInt(required("TELEGRAM_API_ID"), 10),
  telegramApiHash: () => required("TELEGRAM_API_HASH"),
  openaiApiKey: () => required("OPENAI_API_KEY"),
  openaiModel: () => process.env.OPENAI_MODEL || "gpt-4o-mini",
  workerPort: () => parseInt(process.env.WORKER_PORT || "8787", 10),
  workerSecret: () => process.env.WORKER_SECRET || "change-me",
};
