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
  // Railway/Render/Fly set PORT; local dev uses WORKER_PORT.
  workerPort: () =>
    parseInt(process.env.PORT || process.env.WORKER_PORT || "8787", 10),
  // On a container/PaaS (NODE_ENV=production or an injected PORT) the control
  // API must bind all interfaces to be reachable, so we force 0.0.0.0 and
  // ignore any stray WORKER_HOST=127.0.0.1 copied from a local .env. Only local
  // dev honours WORKER_HOST (defaulting to loopback).
  workerHost: () => {
    if (process.env.NODE_ENV === "production" || process.env.PORT) {
      return "0.0.0.0";
    }
    return process.env.WORKER_HOST || "127.0.0.1";
  },
  workerSecret: () => process.env.WORKER_SECRET || "change-me",
};
