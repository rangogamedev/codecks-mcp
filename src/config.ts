/**
 * Environment configuration and constants for codecks-mcp.
 * Reads from environment variables (or .env file via dotenv if available).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// .env loader (zero-dependency, like the Python version)
// ---------------------------------------------------------------------------

function loadEnvFile(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(envPath)) return env;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    env[key] = val;
  }
  return env;
}

// Load .env from CWD
const dotenv = loadEnvFile(resolve(process.cwd(), ".env"));

function getEnv(key: string, fallback = ""): string {
  return dotenv[key] ?? process.env[key] ?? fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const raw = getEnv(key);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function getEnvFloat(key: string, fallback: number): number {
  const raw = getEnv(key);
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? fallback : parsed;
}

function getEnvBool(key: string, fallback = false): boolean {
  const raw = getEnv(key);
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VERSION = "0.1.0";
export const CONTRACT_SCHEMA_VERSION = "1.0";

export const BASE_URL = "https://api.codecks.io";

export const VALID_STATUSES = new Set(["not_started", "started", "done", "blocked", "in_review"]);
export const VALID_PRIORITIES = new Set(["a", "b", "c", "null"]);
export const VALID_SORT_FIELDS = new Set([
  "status",
  "priority",
  "effort",
  "deck",
  "title",
  "owner",
  "updated",
  "created",
]);
export const VALID_CARD_TYPES = new Set(["hero", "doc"]);
export const VALID_SEVERITIES = new Set(["critical", "high", "low", "null"]);

export const PRI_LABELS: Record<string, string> = {
  a: "high",
  b: "med",
  c: "low",
};

// ---------------------------------------------------------------------------
// Configuration (from env)
// ---------------------------------------------------------------------------

export const config = {
  sessionToken: getEnv("CODECKS_TOKEN"),
  accessKey: getEnv("CODECKS_ACCESS_KEY"),
  reportToken: getEnv("CODECKS_REPORT_TOKEN"),
  account: getEnv("CODECKS_ACCOUNT"),
  userId: getEnv("CODECKS_USER_ID"),
  httpTimeout: getEnvInt("CODECKS_HTTP_TIMEOUT_SECONDS", 30) * 1000, // ms
  httpMaxRetries: getEnvInt("CODECKS_HTTP_MAX_RETRIES", 2),
  httpRetryBase: getEnvFloat("CODECKS_HTTP_RETRY_BASE_SECONDS", 1.0),
  httpMaxResponseBytes: getEnvInt("CODECKS_HTTP_MAX_RESPONSE_BYTES", 5_000_000),
  httpLogEnabled: getEnvBool("CODECKS_HTTP_LOG"),
  mcpResponseMode: (() => {
    const mode = getEnv("CODECKS_MCP_RESPONSE_MODE", "legacy").toLowerCase();
    return mode === "envelope" ? "envelope" : "legacy";
  })() as "legacy" | "envelope",
} as const;
