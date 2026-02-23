/**
 * Tool registration index — registers all tool categories on the MCP server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodecksClient } from "../client.js";

import { registerReadTools } from "./read.js";
import { registerHandTools } from "./hand.js";
import { registerMutationTools } from "./mutation.js";
import { registerCommentTools } from "./comments.js";
import { registerPmTools } from "./pm.js";
import { registerFeedbackTools } from "./feedback.js";
import { registerPlanningTools } from "./planning.js";
import { registerRegistryTools } from "./registry.js";

export function registerAllTools(
  server: McpServer,
  client: CodecksClient,
): void {
  registerReadTools(server, client);
  registerHandTools(server, client);
  registerMutationTools(server, client);
  registerCommentTools(server, client);
  registerPmTools(server);
  registerFeedbackTools(server);
  registerPlanningTools(server);
  registerRegistryTools(server);
}
