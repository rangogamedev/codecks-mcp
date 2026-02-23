# codecks-mcp

TypeScript MCP server for [Codecks](https://codecks.io) project management. Exposes 32+ tools for managing cards, decks, milestones, tags, and PM workflows via the [Model Context Protocol](https://modelcontextprotocol.io).

Built with [@modelcontextprotocol/server](https://www.npmjs.com/package/@modelcontextprotocol/server), [zod](https://zod.dev), and [Express](https://expressjs.com).

## Quick Start

```bash
# Run directly (no install needed)
npx codecks-mcp

# Or install globally
npm install -g codecks-mcp
codecks-mcp
```

## Configuration

Create a `.env` file in your working directory:

```env
CODECKS_TOKEN=your_session_cookie
CODECKS_ACCOUNT=your_account_slug
```

### Tokens

| Variable | Source | Expires |
|----------|--------|---------|
| `CODECKS_TOKEN` | Browser DevTools > Cookie `at` | Yes |
| `CODECKS_REPORT_TOKEN` | CLI `generate-token` command | No |
| `CODECKS_ACCOUNT` | Your Codecks account slug | N/A |
| `CODECKS_USER_ID` | Auto-discovered if unset | N/A |

### Optional Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `CODECKS_MCP_RESPONSE_MODE` | `legacy` | `legacy` or `envelope` |
| `CODECKS_HTTP_TIMEOUT_SECONDS` | `30` | Request timeout |
| `CODECKS_HTTP_MAX_RETRIES` | `2` | Retry count |

## Transports

### stdio (default)

```bash
codecks-mcp
```

### HTTP

```bash
codecks-mcp --transport http --port 3000
```

Endpoints:
- `POST /mcp` — MCP protocol (Streamable HTTP)
- `GET /ping` — Health check

## IDE Setup

### Claude Code

```json
{
  "mcpServers": {
    "codecks": {
      "command": "npx",
      "args": ["-y", "codecks-mcp"]
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "codecks": {
      "command": "npx",
      "args": ["-y", "codecks-mcp"]
    }
  }
}
```

### Remote (HTTP)

```json
{
  "mcpServers": {
    "codecks": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Tools

### Read (10)
| Tool | Description |
|------|-------------|
| `get_account` | Current account info |
| `list_cards` | List/filter cards with pagination |
| `get_card` | Full card details |
| `list_decks` | All decks |
| `list_projects` | Projects with decks |
| `list_milestones` | Milestones |
| `list_tags` | Project-level tags |
| `list_activity` | Recent activity feed |
| `pm_focus` | PM dashboard (blocked, stale, suggested) |
| `standup` | Daily standup summary |

### Hand (3)
| Tool | Description |
|------|-------------|
| `list_hand` | Personal work queue |
| `add_to_hand` | Add cards to hand |
| `remove_from_hand` | Remove cards from hand |

### Mutation (9)
| Tool | Description |
|------|-------------|
| `create_card` | Create card (supports sub-cards) |
| `update_cards` | Batch update properties |
| `mark_done` | Mark cards done |
| `mark_started` | Mark cards started |
| `archive_card` | Archive (reversible) |
| `unarchive_card` | Restore archived |
| `delete_card` | Permanent delete |
| `scaffold_feature` | Hero + lane sub-cards |
| `split_features` | Batch-split features |

### Comments (5)
| Tool | Description |
|------|-------------|
| `create_comment` | Start thread |
| `reply_comment` | Reply to thread |
| `close_comment` | Resolve thread |
| `reopen_comment` | Reopen thread |
| `list_conversations` | List threads |

### PM Session (3)
| Tool | Description |
|------|-------------|
| `get_pm_playbook` | Methodology guide |
| `get_workflow_preferences` | Load preferences |
| `save_workflow_preferences` | Save preferences |

### Feedback (2)
| Tool | Description |
|------|-------------|
| `save_cli_feedback` | Save feedback |
| `get_cli_feedback` | Read feedback |

## Security

- Prompt injection detection (6 regex patterns)
- `[USER_DATA]` boundary tagging on user-authored content
- Input validation with zod schemas + length limits
- UUID validation on all card IDs
- Control character stripping

## Development

```bash
# Install
pnpm install

# Dev mode (tsx, auto-reload)
pnpm dev

# Build
pnpm build

# Test
pnpm test

# Lint + format
pnpm lint
pnpm format:check

# Type check
pnpm typecheck
```

## Also Available

- **Python version**: [codecks-mcp-python](https://github.com/rangogamedev/codecks-mcp-python) — same tools, Python runtime
- **Full CLI**: [codecks-cli](https://github.com/rangogamedev/codecks-cli) — CLI + library with formatters, GDD sync, and more

## License

MIT
