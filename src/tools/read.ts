/**
 * Read tools — account, cards, decks, projects, milestones, tags, activity, pm_focus, standup.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodecksClient } from "../client.js";
import { contractError, finalizeToolResult } from "../contract.js";
import { sanitizeCard, sanitizeActivity, validateUuid } from "../security.js";
import { CliError, SetupError } from "../errors.js";

// Slim card: drop redundant raw IDs for token efficiency
const SLIM_DROP = new Set([
  "deckId",
  "deck_id",
  "milestoneId",
  "milestone_id",
  "assignee",
  "projectId",
  "project_id",
  "childCardInfo",
  "child_card_info",
  "masterTags",
]);

function slimCard(card: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(card)) {
    if (!SLIM_DROP.has(k)) out[k] = v;
  }
  return out;
}

function handleError(err: unknown): Record<string, unknown> {
  if (err instanceof SetupError) return contractError(String(err), "setup");
  if (err instanceof CliError) return contractError(String(err), "error");
  return contractError(`Unexpected error: ${err}`, "error");
}

export function registerReadTools(server: McpServer, client: CodecksClient): void {
  server.registerTool(
    "get_account",
    {
      title: "Get Account",
      description: "Get current account info (name, id, email, role).",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const result = await client.getAccount();
        return {
          content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }],
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
    "list_cards",
    {
      title: "List Cards",
      description: "List cards. Filters combine with AND.",
      inputSchema: z.object({
        deck: z.string().optional().describe("Filter by deck name"),
        status: z
          .string()
          .optional()
          .describe("Comma-separated: not_started, started, done, blocked, in_review"),
        project: z.string().optional().describe("Filter by project name"),
        search: z.string().optional().describe("Search in title and content"),
        milestone: z.string().optional().describe("Filter by milestone name"),
        tag: z.string().optional().describe("Filter by tag name"),
        owner: z.string().optional().describe("Owner name, or 'none' for unassigned"),
        priority: z.string().optional().describe("Comma-separated: a, b, c, null"),
        sort: z
          .enum(["status", "priority", "effort", "deck", "title", "owner", "updated", "created"])
          .optional(),
        card_type: z.enum(["hero", "doc"]).optional(),
        hero: z.string().optional().describe("Filter by hero card UUID"),
        hand_only: z.boolean().default(false),
        stale_days: z.number().optional().describe("Cards not updated in N days"),
        updated_after: z.string().optional().describe("YYYY-MM-DD"),
        updated_before: z.string().optional().describe("YYYY-MM-DD"),
        archived: z.boolean().default(false),
        include_stats: z.boolean().default(false),
        limit: z.number().default(50),
        offset: z.number().default(0),
      }),
    },
    async (args) => {
      try {
        const result = await client.listCards({
          deck: args.deck,
          status: args.status,
          project: args.project,
          search: args.search,
          milestone: args.milestone,
          tag: args.tag,
          owner: args.owner,
          priority: args.priority,
          sort: args.sort,
          cardType: args.card_type,
          hero: args.hero,
          handOnly: args.hand_only,
          staleDays: args.stale_days,
          updatedAfter: args.updated_after,
          updatedBefore: args.updated_before,
          archived: args.archived,
          includeStats: args.include_stats,
        });

        const allCards = (result.cards ?? []) as Record<string, unknown>[];
        const total = allCards.length;
        const page = allCards.slice(args.offset, args.offset + args.limit);
        const payload = {
          cards: page.map((c) => sanitizeCard(slimCard(c))),
          stats: result.stats,
          total_count: total,
          has_more: args.offset + args.limit < total,
          limit: args.limit,
          offset: args.offset,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(finalizeToolResult(payload)) }],
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
    "get_card",
    {
      title: "Get Card",
      description:
        "Get full card details (content, checklist, sub-cards, conversations, hand status).",
      inputSchema: z.object({
        card_id: z.string().describe("Full 36-char UUID"),
        include_content: z
          .boolean()
          .default(true)
          .describe("False to strip body for metadata-only checks"),
        include_conversations: z.boolean().default(true).describe("False to skip comment threads"),
        archived: z.boolean().default(false),
      }),
    },
    async (args) => {
      try {
        validateUuid(args.card_id);
        const result = await client.getCard(args.card_id, {
          includeContent: args.include_content,
          includeConversations: args.include_conversations,
          archived: args.archived,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(finalizeToolResult(sanitizeCard(result))),
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
    "list_decks",
    {
      title: "List Decks",
      description: "List all decks. Set include_card_counts=True for per-deck counts.",
      inputSchema: z.object({
        include_card_counts: z.boolean().default(false),
      }),
    },
    async (args) => {
      try {
        const result = await client.listDecks(args.include_card_counts);
        return {
          content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }],
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
    "list_projects",
    {
      title: "List Projects",
      description: "List all projects with deck info.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const result = await client.listProjects();
        return {
          content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }],
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
    "list_milestones",
    {
      title: "List Milestones",
      description: "List all milestones with card counts.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const result = await client.listMilestones();
        return {
          content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }],
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
    "list_tags",
    {
      title: "List Tags",
      description: "List project-level tags (sanctioned taxonomy).",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const result = await client.listTags();
        return {
          content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }],
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
    "list_activity",
    {
      title: "List Activity",
      description: "Show recent activity feed.",
      inputSchema: z.object({
        limit: z.number().default(20),
      }),
    },
    async (args) => {
      try {
        const result = await client.listActivity(args.limit);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(finalizeToolResult(sanitizeActivity(result))),
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
    "pm_focus",
    {
      title: "PM Focus",
      description: "PM focus dashboard: blocked, stale, unassigned, and suggested next cards.",
      inputSchema: z.object({
        project: z.string().optional().describe("Filter to a specific project"),
        owner: z.string().optional().describe("Filter to a specific owner"),
        limit: z.number().default(5).describe("Max cards per category"),
        stale_days: z.number().default(14).describe("Days since last update to consider stale"),
      }),
    },
    async (args) => {
      try {
        const result = await client.pmFocus({
          project: args.project,
          owner: args.owner,
          limit: args.limit,
          staleDays: args.stale_days,
        });
        // Sanitize card lists
        for (const key of ["blocked", "in_review", "stale", "suggested"]) {
          if (Array.isArray((result as Record<string, unknown>)[key])) {
            (result as Record<string, unknown>)[key] = (
              (result as Record<string, unknown>)[key] as Record<string, unknown>[]
            ).map((c) => sanitizeCard(slimCard(c)));
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }],
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
    "standup",
    {
      title: "Standup",
      description: "Daily standup summary: recently done, in-progress, blocked, and hand.",
      inputSchema: z.object({
        days: z.number().default(2).describe("Lookback window for recently done cards"),
        project: z.string().optional(),
        owner: z.string().optional(),
      }),
    },
    async (args) => {
      try {
        const result = await client.standup({
          days: args.days,
          project: args.project,
          owner: args.owner,
        });
        for (const key of ["recently_done", "in_progress", "blocked", "hand"]) {
          if (Array.isArray((result as Record<string, unknown>)[key])) {
            (result as Record<string, unknown>)[key] = (
              (result as Record<string, unknown>)[key] as Record<string, unknown>[]
            ).map((c) => sanitizeCard(slimCard(c)));
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }],
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
