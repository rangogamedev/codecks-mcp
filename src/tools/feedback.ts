/**
 * Feedback tools — save and read CLI feedback (local, no API needed).
 */

import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { contractError, finalizeToolResult } from "../contract.js";
import { validateInput } from "../security.js";
import { CliError } from "../errors.js";

const FEEDBACK_PATH = resolve(process.cwd(), ".cli_feedback.json");
const MAX_ITEMS = 200;

function handleError(err: unknown): Record<string, unknown> {
  if (err instanceof CliError) return contractError(String(err), "error");
  return contractError(`Unexpected error: ${err}`, "error");
}

export function registerFeedbackTools(server: McpServer): void {
  server.registerTool(
    "save_cli_feedback",
    {
      title: "Save CLI Feedback",
      description:
        "Save a CLI feedback item for the development team. No auth needed.",
      inputSchema: z.object({
        category: z.enum([
          "missing_feature",
          "bug",
          "error",
          "improvement",
          "usability",
        ]),
        message: z.string().describe("Feedback message (max 1000 chars)"),
        tool_name: z
          .string()
          .optional()
          .describe("Which MCP tool this relates to"),
        context: z
          .string()
          .optional()
          .describe("Brief session context (max 500 chars)"),
      }),
    },
    async (args) => {
      try {
        const message = validateInput(args.message, "feedback_message");
        const context = args.context
          ? validateInput(args.context, "feedback_context")
          : undefined;

        const item: Record<string, unknown> = {
          timestamp: new Date().toISOString(),
          category: args.category,
          message,
        };
        if (args.tool_name) item.tool_name = args.tool_name;
        if (context) item.context = context;

        let items: Record<string, unknown>[] = [];
        try {
          if (existsSync(FEEDBACK_PATH)) {
            const data = JSON.parse(readFileSync(FEEDBACK_PATH, "utf-8"));
            if (Array.isArray(data?.items)) items = data.items;
          }
        } catch {
          // Start fresh
        }

        items.push(item);
        if (items.length > MAX_ITEMS) items = items.slice(-MAX_ITEMS);

        writeFileSync(
          FEEDBACK_PATH,
          JSON.stringify(
            { items, updated_at: new Date().toISOString() },
            null,
            2,
          ),
          "utf-8",
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                finalizeToolResult({ saved: true, total_items: items.length }),
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(finalizeToolResult(handleError(err))),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_cli_feedback",
    {
      title: "Get CLI Feedback",
      description:
        "Read saved CLI feedback items. Optionally filter by category. No auth needed.",
      inputSchema: z.object({
        category: z
          .enum(["missing_feature", "bug", "error", "improvement", "usability"])
          .optional(),
      }),
    },
    async (args) => {
      try {
        if (!existsSync(FEEDBACK_PATH)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  finalizeToolResult({ found: false, items: [], count: 0 }),
                ),
              },
            ],
          };
        }
        const data = JSON.parse(readFileSync(FEEDBACK_PATH, "utf-8"));
        let items: Record<string, unknown>[] = data?.items ?? [];
        if (args.category) {
          items = items.filter((i) => i.category === args.category);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                finalizeToolResult({
                  found: items.length > 0,
                  items,
                  count: items.length,
                }),
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(finalizeToolResult(handleError(err))),
            },
          ],
        };
      }
    },
  );
}
