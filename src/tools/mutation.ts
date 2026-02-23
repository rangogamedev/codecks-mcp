/**
 * Mutation tools — create, update, mark_done, mark_started, archive, unarchive, delete, scaffold, split.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodecksClient } from "../client.js";
import { contractError, finalizeToolResult } from "../contract.js";
import { validateInput, validateUuid, validateUuidList } from "../security.js";
import { CliError, SetupError } from "../errors.js";

function handleError(err: unknown): Record<string, unknown> {
  if (err instanceof SetupError) return contractError(String(err), "setup");
  if (err instanceof CliError) return contractError(String(err), "error");
  return contractError(`Unexpected error: ${err}`, "error");
}

export function registerMutationTools(server: McpServer, client: CodecksClient): void {
  server.registerTool("create_card", {
    title: "Create Card",
    description: "Create a new card. Set deck/project to place it. Use parent to nest as sub-card.",
    inputSchema: z.object({
      title: z.string().describe("Card title (max 500 chars)"),
      content: z.string().optional().describe("Card body. Use '- []' for checkboxes"),
      deck: z.string().optional().describe("Destination deck name"),
      project: z.string().optional(),
      severity: z.enum(["critical", "high", "low", "null"]).optional(),
      doc: z.boolean().default(false).describe("True for doc card"),
      allow_duplicate: z.boolean().default(false),
      parent: z.string().optional().describe("Parent card UUID for sub-cards"),
    }),
  }, async (args) => {
    try {
      const title = validateInput(args.title, "title");
      const content = args.content ? validateInput(args.content, "content") : undefined;
      const result = await client.createCard({
        title,
        content,
        deck: args.deck,
        project: args.project,
        severity: args.severity,
        doc: args.doc,
        allowDuplicate: args.allow_duplicate,
        parent: args.parent,
      });
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("update_cards", {
    title: "Update Cards",
    description: "Update card properties. Doc cards: only owner/tags/milestone/deck/title/content/hero.",
    inputSchema: z.object({
      card_ids: z.array(z.string()).describe("Full 36-char UUIDs"),
      status: z.enum(["not_started", "started", "done", "blocked", "in_review"]).optional(),
      priority: z.enum(["a", "b", "c", "null"]).optional(),
      effort: z.string().optional().describe("Integer string, or 'null' to clear"),
      deck: z.string().optional(),
      title: z.string().optional().describe("Single card only"),
      content: z.string().optional(),
      milestone: z.string().optional().describe("Name, or 'none' to clear"),
      hero: z.string().optional().describe("Parent card UUID, or 'none' to detach"),
      owner: z.string().optional().describe("Name, or 'none' to unassign"),
      tags: z.string().optional().describe("Comma-separated, or 'none' to clear"),
      doc: z.enum(["true", "false"]).optional(),
      continue_on_error: z.boolean().default(false),
    }),
  }, async (args) => {
    try {
      validateUuidList(args.card_ids);
      if (args.title) validateInput(args.title, "title");
      if (args.content) validateInput(args.content, "content");
      const result = await client.updateCards({
        cardIds: args.card_ids,
        status: args.status,
        priority: args.priority,
        effort: args.effort,
        deck: args.deck,
        title: args.title,
        content: args.content,
        milestone: args.milestone,
        hero: args.hero,
        owner: args.owner,
        tags: args.tags,
        doc: args.doc,
        continueOnError: args.continue_on_error,
      });
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("mark_done", {
    title: "Mark Done",
    description: "Mark cards as done.",
    inputSchema: z.object({
      card_ids: z.array(z.string()).describe("Full 36-char UUIDs"),
    }),
  }, async (args) => {
    try {
      validateUuidList(args.card_ids);
      const result = await client.markDone(args.card_ids);
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("mark_started", {
    title: "Mark Started",
    description: "Mark cards as started.",
    inputSchema: z.object({
      card_ids: z.array(z.string()).describe("Full 36-char UUIDs"),
    }),
  }, async (args) => {
    try {
      validateUuidList(args.card_ids);
      const result = await client.markStarted(args.card_ids);
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("archive_card", {
    title: "Archive Card",
    description: "Archive a card (reversible).",
    inputSchema: z.object({
      card_id: z.string().describe("Full 36-char UUID"),
    }),
  }, async (args) => {
    try {
      validateUuid(args.card_id);
      const result = await client.archiveCard(args.card_id);
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("unarchive_card", {
    title: "Unarchive Card",
    description: "Restore an archived card.",
    inputSchema: z.object({
      card_id: z.string().describe("Full 36-char UUID"),
    }),
  }, async (args) => {
    try {
      validateUuid(args.card_id);
      const result = await client.unarchiveCard(args.card_id);
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("delete_card", {
    title: "Delete Card",
    description: "Permanently delete a card. Cannot be undone — use archive_card if reversibility needed.",
    inputSchema: z.object({
      card_id: z.string().describe("Full 36-char UUID"),
    }),
  }, async (args) => {
    try {
      validateUuid(args.card_id);
      const result = await client.deleteCard(args.card_id);
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("scaffold_feature", {
    title: "Scaffold Feature",
    description: "Create a Hero card with Code/Design/Art/Audio sub-cards.",
    inputSchema: z.object({
      title: z.string().describe("Feature title"),
      hero_deck: z.string(),
      code_deck: z.string(),
      design_deck: z.string(),
      art_deck: z.string().optional().describe("Required unless skip_art=true"),
      skip_art: z.boolean().default(false),
      audio_deck: z.string().optional().describe("Required unless skip_audio=true"),
      skip_audio: z.boolean().default(false),
      description: z.string().optional(),
      owner: z.string().optional(),
      priority: z.enum(["a", "b", "c", "null"]).optional(),
      effort: z.number().optional(),
      allow_duplicate: z.boolean().default(false),
    }),
  }, async (args) => {
    try {
      const title = validateInput(args.title, "title");
      const description = args.description ? validateInput(args.description, "description") : undefined;
      const result = await client.scaffoldFeature({
        title,
        heroDeck: args.hero_deck,
        codeDeck: args.code_deck,
        designDeck: args.design_deck,
        artDeck: args.art_deck,
        skipArt: args.skip_art,
        audioDeck: args.audio_deck,
        skipAudio: args.skip_audio,
        description,
        owner: args.owner,
        priority: args.priority,
        effort: args.effort,
        allowDuplicate: args.allow_duplicate,
      });
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });

  server.registerTool("split_features", {
    title: "Split Features",
    description: "Batch-split unsplit feature cards into lane sub-cards. Use dry_run=true to preview.",
    inputSchema: z.object({
      deck: z.string().describe("Source deck containing feature cards"),
      code_deck: z.string(),
      design_deck: z.string(),
      art_deck: z.string().optional(),
      skip_art: z.boolean().default(false),
      audio_deck: z.string().optional(),
      skip_audio: z.boolean().default(false),
      priority: z.enum(["a", "b", "c", "null"]).optional(),
      dry_run: z.boolean().default(false),
    }),
  }, async (args) => {
    try {
      const result = await client.splitFeatures({
        deck: args.deck,
        codeDeck: args.code_deck,
        designDeck: args.design_deck,
        artDeck: args.art_deck,
        skipArt: args.skip_art,
        audioDeck: args.audio_deck,
        skipAudio: args.skip_audio,
        priority: args.priority,
        dryRun: args.dry_run,
      });
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(result)) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) }] };
    }
  });
}
