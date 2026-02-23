/**
 * Hand tools — list_hand, add_to_hand, remove_from_hand.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodecksClient } from "../client.js";
import { contractError, finalizeToolResult } from "../contract.js";
import { sanitizeCard, validateUuidList } from "../security.js";
import { CliError, SetupError } from "../errors.js";

function handleError(err: unknown): Record<string, unknown> {
  if (err instanceof SetupError) return contractError(String(err), "setup");
  if (err instanceof CliError) return contractError(String(err), "error");
  return contractError(`Unexpected error: ${err}`, "error");
}

const SLIM_DROP = new Set([
  "deckId", "deck_id", "milestoneId", "milestone_id", "assignee",
  "projectId", "project_id", "childCardInfo", "child_card_info", "masterTags",
]);

function slimCard(card: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(card)) {
    if (!SLIM_DROP.has(k)) out[k] = v;
  }
  return out;
}

export function registerHandTools(server: McpServer, client: CodecksClient): void {
  server.registerTool("list_hand", {
    title: "List Hand",
    description: "List cards in the user's hand (personal work queue), sorted by hand order.",
    inputSchema: z.object({}),
  }, async () => {
    try {
      const result = await client.listHand();
      const sanitized = result.map((c) => sanitizeCard(slimCard(c)));
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(sanitized)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("add_to_hand", {
    title: "Add to Hand",
    description: "Add cards to the user's hand.",
    inputSchema: z.object({
      card_ids: z.array(z.string()).describe("Full 36-char UUIDs"),
    }),
  }, async (args) => {
    try {
      validateUuidList(args.card_ids);
      const result = await client.addToHand(args.card_ids);
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("remove_from_hand", {
    title: "Remove from Hand",
    description: "Remove cards from the user's hand.",
    inputSchema: z.object({
      card_ids: z.array(z.string()).describe("Full 36-char UUIDs"),
    }),
  }, async (args) => {
    try {
      validateUuidList(args.card_ids);
      const result = await client.removeFromHand(args.card_ids);
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });
}
