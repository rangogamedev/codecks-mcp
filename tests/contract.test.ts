/**
 * Tests for the response contract system.
 */

import { describe, it, expect } from "vitest";
import { contractError, ensureContractDict, finalizeToolResult } from "../src/contract.js";

describe("contractError", () => {
  it("creates error envelope with defaults", () => {
    const result = contractError("Something went wrong");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Something went wrong");
    expect(result.type).toBe("error");
    expect(result.schema_version).toBe("1.0");
    expect(result.error_detail.type).toBe("error");
    expect(result.error_detail.message).toBe("Something went wrong");
  });

  it("supports custom error types", () => {
    const result = contractError("Token expired", "setup");
    expect(result.type).toBe("setup");
    expect(result.error_detail.type).toBe("setup");
  });
});

describe("ensureContractDict", () => {
  it("adds schema_version to success payloads", () => {
    const result = ensureContractDict({ data: "hello" });
    expect(result.schema_version).toBe("1.0");
    expect(result.ok).toBe(true);
  });

  it("preserves existing ok=false", () => {
    const result = ensureContractDict({
      ok: false,
      error: "bad",
      type: "error",
    });
    expect(result.ok).toBe(false);
    expect(result.error_detail).toBeDefined();
  });
});

describe("finalizeToolResult", () => {
  it("adds contract metadata to dict results", () => {
    const result = finalizeToolResult({ cards: [] });
    expect((result as Record<string, unknown>).ok).toBe(true);
    expect((result as Record<string, unknown>).schema_version).toBe("1.0");
  });

  it("passes through non-dict results in legacy mode", () => {
    const result = finalizeToolResult([1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });

  it("passes through error dicts", () => {
    const error = contractError("bad thing");
    const result = finalizeToolResult(error) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("bad thing");
  });
});
