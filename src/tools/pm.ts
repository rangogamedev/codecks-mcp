/**
 * PM session tools — playbook, preferences (local, no API needed).
 */

import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { contractError, finalizeToolResult } from "../contract.js";
import { validateInput, tagUserText } from "../security.js";
import { CliError } from "../errors.js";

const PREFS_PATH = resolve(process.cwd(), ".pm_preferences.json");

function handleError(err: unknown): Record<string, unknown> {
  if (err instanceof CliError) return contractError(String(err), "error");
  return contractError(`Unexpected error: ${err}`, "error");
}

export function registerPmTools(server: McpServer): void {
  server.registerTool("get_pm_playbook", {
    title: "Get PM Playbook",
    description: "Get PM session methodology guide. No auth needed.",
    inputSchema: z.object({}),
  }, async () => {
    // The playbook would be bundled or fetched. For now, return a stub.
    const playbook = "PM Playbook: Use pm_focus for dashboard, standup for daily summary. " +
      "Prioritize blocked cards first, then stale cards. " +
      "Save observations with save_workflow_preferences.";
    return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult({ playbook })) }] };
  });

  server.registerTool("get_workflow_preferences", {
    title: "Get Workflow Preferences",
    description: "Load user workflow preferences from past sessions. No auth needed.",
    inputSchema: z.object({}),
  }, async () => {
    try {
      if (!existsSync(PREFS_PATH)) {
        return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult({ found: false, preferences: [] })) }] };
      }
      const data = JSON.parse(readFileSync(PREFS_PATH, "utf-8"));
      const raw = data.observations ?? [];
      const prefs = raw.map((p: unknown) =>
        typeof p === "string" ? tagUserText(p) : p,
      );
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult({ found: true, preferences: prefs })) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("save_workflow_preferences", {
    title: "Save Workflow Preferences",
    description: "Save observed workflow patterns from current session. No auth needed.",
    inputSchema: z.object({
      observations: z.array(z.string()).describe("Workflow patterns observed (max 50 items, 500 chars each)"),
    }),
  }, async (args) => {
    try {
      const validated = args.observations
        .slice(0, 50)
        .map((obs) => validateInput(obs, "observation"));
      const data = {
        observations: validated,
        updated_at: new Date().toISOString(),
      };
      writeFileSync(PREFS_PATH, JSON.stringify(data, null, 2), "utf-8");
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult({ saved: validated.length })) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });
}
