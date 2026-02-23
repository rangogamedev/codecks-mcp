/**
 * codecks-mcp — MCP server for Codecks project management.
 *
 * Transports:
 *   stdio (default): codecks-mcp
 *   http:            codecks-mcp --transport http --port 3000
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CodecksClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";
import { VERSION } from "./config.js";

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const transport = getArg("transport") ?? "stdio";
const port = parseInt(getArg("port") ?? "3000", 10);

// ---------------------------------------------------------------------------
// Create server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "codecks",
  version: VERSION,
});

const client = new CodecksClient();

registerAllTools(server, client);

// ---------------------------------------------------------------------------
// Start transport
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (transport === "http") {
    // Dynamic import to avoid loading express for stdio users
    const { default: express } = await import("express");
    const { randomUUID } = await import("node:crypto");
    const { StreamableHTTPServerTransport } =
      await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

    const app = express();
    app.use(express.json());

    app.post("/mcp", async (req, res) => {
      const httpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      await server.connect(httpTransport);
      await httpTransport.handleRequest(req, res);
    });

    app.get("/ping", (_req, res) => {
      res.json({ ok: true, version: VERSION });
    });

    app.listen(port, () => {
      console.error(`codecks-mcp HTTP server listening on port ${port}`);
    });
  } else {
    // stdio transport (default)
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error(`codecks-mcp v${VERSION} running on stdio`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
