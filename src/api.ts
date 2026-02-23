/**
 * HTTP request layer for the Codecks API.
 * Direct port of codecks_cli/api.py using Node.js fetch.
 */

import { randomUUID } from "node:crypto";
import { config, BASE_URL } from "./config.js";
import { CliError, HTTPError, SetupError } from "./errors.js";

const RETRYABLE_HTTP_CODES = new Set([429, 502, 503, 504]);

// ---------------------------------------------------------------------------
// HTTP request
// ---------------------------------------------------------------------------

async function httpRequest(
  url: string,
  options: {
    data?: unknown;
    method?: string;
    headers?: Record<string, string>;
    idempotent?: boolean;
  } = {},
): Promise<unknown> {
  const {
    data,
    method = "POST",
    headers = {},
    idempotent = false,
  } = options;

  const body = data ? JSON.stringify(data) : undefined;
  const maxAttempts = 1 + Math.max(0, idempotent ? config.httpMaxRetries : 0);
  const timeout = Math.max(1000, config.httpTimeout);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const retryable = RETRYABLE_HTTP_CODES.has(response.status);
        const canRetry =
          idempotent && attempt < maxAttempts - 1 && retryable;

        if (canRetry) {
          const retryAfter =
            parseInt(response.headers.get("Retry-After") ?? "", 10) ||
            config.httpRetryBase * 2 ** attempt;
          await sleep(retryAfter * 1000);
          continue;
        }

        throw new HTTPError(
          response.status,
          response.statusText,
          errorBody,
          Object.fromEntries(response.headers.entries()),
        );
      }

      const raw = await response.text();
      if (raw.length > config.httpMaxResponseBytes) {
        throw new CliError(
          `[ERROR] Response too large from Codecks API (>${config.httpMaxResponseBytes} bytes).`,
        );
      }

      try {
        return JSON.parse(raw);
      } catch {
        throw new CliError(
          "[ERROR] Unexpected response from Codecks API (not valid JSON).",
        );
      }
    } catch (err) {
      clearTimeout(timer);

      if (err instanceof HTTPError || err instanceof CliError) throw err;

      if (err instanceof DOMException && err.name === "AbortError") {
        if (idempotent && attempt < maxAttempts - 1) {
          await sleep(config.httpRetryBase * 2 ** attempt * 1000);
          continue;
        }
        throw new CliError(
          `[ERROR] Request timed out after ${timeout / 1000} seconds. Is Codecks API reachable?`,
        );
      }

      if (idempotent && attempt < maxAttempts - 1) {
        await sleep(config.httpRetryBase * 2 ** attempt * 1000);
        continue;
      }

      throw new CliError(
        `[ERROR] Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new CliError("[ERROR] Request failed after all retries.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Authenticated request helpers
// ---------------------------------------------------------------------------

export async function sessionRequest(
  path = "/",
  data?: unknown,
  options: { method?: string; idempotent?: boolean } = {},
): Promise<Record<string, unknown>> {
  const url = BASE_URL + path;
  const headers: Record<string, string> = {
    "X-Auth-Token": config.sessionToken,
    "X-Account": config.account,
    "X-Request-Id": randomUUID(),
  };

  try {
    const result = await httpRequest(url, {
      data,
      headers,
      method: options.method ?? "POST",
      idempotent: options.idempotent,
    });
    return expectObject(result, "session");
  } catch (err) {
    if (err instanceof HTTPError) {
      if (err.code === 401 || err.code === 403) {
        throw new SetupError(
          "[TOKEN_EXPIRED] The Codecks session token has expired. " +
            "Please provide a fresh 'at' cookie from browser DevTools.",
        );
      }
      if (err.code === 429) {
        throw new CliError(
          "[ERROR] Rate limit reached (Codecks allows ~40 req/5s). Wait and retry.",
        );
      }
      throw new CliError(`[ERROR] HTTP ${err.code}: ${err.reason}`);
    }
    throw err;
  }
}

export async function reportRequest(
  content: string,
  options: { severity?: string; email?: string } = {},
): Promise<Record<string, unknown>> {
  if (!config.reportToken) {
    throw new CliError(
      "[ERROR] CODECKS_REPORT_TOKEN not set. Generate one via the CLI.",
    );
  }

  const payload: Record<string, string> = { content };
  if (options.severity) payload.severity = options.severity;
  if (options.email) payload.userEmail = options.email;

  const url = `${BASE_URL}/user-report/v1/create-report?token=${config.reportToken}`;
  const headers: Record<string, string> = { "X-Request-Id": randomUUID() };

  try {
    const result = await httpRequest(url, { data: payload, headers });
    return expectObject(result, "report");
  } catch (err) {
    if (err instanceof HTTPError && err.code === 401) {
      throw new CliError(
        "[ERROR] Report token is invalid or disabled. Generate a new one.",
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Query and dispatch helpers
// ---------------------------------------------------------------------------

export async function query(
  q: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await sessionRequest("/", { query: q }, { idempotent: true });
  delete result._root;
  return result;
}

export async function dispatch(
  path: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  return sessionRequest(`/dispatch/${path}`, data);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectObject(
  result: unknown,
  operation: string,
): Record<string, unknown> {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  throw new CliError(
    `[ERROR] Unexpected ${operation} response shape: expected JSON object.`,
  );
}
