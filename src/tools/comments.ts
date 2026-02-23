/**
 * Comment tools — create, reply, close, reopen, list conversations.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodecksClient } from "../client.js";
import { contractError, finalizeToolResult } from "../contract.js";
import { validateInput, validateUuid, sanitizeConversations } from "../security.js";
import { CliError, SetupError } from "../errors.js";

function handleError(err: unknown): Record<string, unknown> {
  if (err instanceof SetupError) return contractError(String(err), "setup");
  if (err instanceof CliError) return contractError(String(err), "error");
  return contractError(`Unexpected error: ${err}`, "error");
}

export function registerCommentTools(server: McpServer, client: CodecksClient): void {
  server.registerTool(
    "create_comment",
    {
      title: "Create Comment",
      description: "Start a new comment thread on a card.",
      inputSchema: z.object({
        card_id: z.string().describe("Full 36-char UUID"),
        message: z.string().describe("Comment message"),
      }),
    },
    async (args) => {
      try {
        validateUuid(args.card_id);
        const message = validateInput(args.message, "message");
        const result = await client.createComment(args.card_id, message);
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
    "reply_comment",
    {
      title: "Reply Comment",
      description: "Reply to an existing comment thread.",
      inputSchema: z.object({
        thread_id: z.string().describe("Thread ID from list_conversations"),
        message: z.string(),
      }),
    },
    async (args) => {
      try {
        const message = validateInput(args.message, "message");
        const result = await client.replyComment(args.thread_id, message);
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
    "close_comment",
    {
      title: "Close Comment",
      description: "Close (resolve) a comment thread.",
      inputSchema: z.object({
        thread_id: z.string(),
        card_id: z.string().describe("Full 36-char UUID"),
      }),
    },
    async (args) => {
      try {
        validateUuid(args.card_id);
        const result = await client.closeComment(args.thread_id, args.card_id);
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
    "reopen_comment",
    {
      title: "Reopen Comment",
      description: "Reopen a closed comment thread.",
      inputSchema: z.object({
        thread_id: z.string(),
        card_id: z.string().describe("Full 36-char UUID"),
      }),
    },
    async (args) => {
      try {
        validateUuid(args.card_id);
        const result = await client.reopenComment(args.thread_id, args.card_id);
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
    "list_conversations",
    {
      title: "List Conversations",
      description: "List all comment threads on a card with messages and thread IDs.",
      inputSchema: z.object({
        card_id: z.string().describe("Full 36-char UUID"),
      }),
    },
    async (args) => {
      try {
        validateUuid(args.card_id);
        const result = await client.listConversations(args.card_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(finalizeToolResult(sanitizeConversations(result))),
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
