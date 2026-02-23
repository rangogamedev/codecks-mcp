/**
 * MCP response contract system.
 * Handles response finalization and error envelopes.
 * Mirrors the Python _finalize_tool_result / _contract_error system.
 */

import { CONTRACT_SCHEMA_VERSION, config } from "./config.js";

export interface ContractError {
  ok: false;
  schema_version: string;
  type: string;
  error: string;
  error_detail: {
    type: string;
    message: string;
  };
  [key: string]: unknown;
}

export function contractError(
  message: string,
  errorType = "error",
): ContractError {
  return {
    ok: false,
    schema_version: CONTRACT_SCHEMA_VERSION,
    type: errorType,
    error: message,
    error_detail: {
      type: errorType,
      message,
    },
  };
}

export function ensureContractDict(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...payload };
  out.schema_version ??= CONTRACT_SCHEMA_VERSION;

  if (out.ok === false) {
    const errorType = String(out.type ?? "error");
    let errorMessage = out.error;
    if (typeof errorMessage !== "string") {
      errorMessage = String(errorMessage);
      out.error = errorMessage;
    }
    out.error_detail ??= {
      type: errorType,
      message: errorMessage as string,
    };
    return out;
  }

  out.ok ??= true;
  return out;
}

export function finalizeToolResult(result: unknown): unknown {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    const dict = result as Record<string, unknown>;
    const normalized = ensureContractDict(dict);

    if (normalized.ok === false) return normalized;

    if (config.mcpResponseMode === "envelope") {
      const data = { ...normalized };
      delete data.ok;
      delete data.schema_version;
      return {
        ok: true,
        schema_version: CONTRACT_SCHEMA_VERSION,
        data,
      };
    }

    return normalized;
  }

  if (config.mcpResponseMode === "envelope") {
    return {
      ok: true,
      schema_version: CONTRACT_SCHEMA_VERSION,
      data: result,
    };
  }

  return result;
}
