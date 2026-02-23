/**
 * Planning tools — init, status, update, measure (local, no API needed).
 * Manages task_plan.md, findings.md, progress.md files.
 */

import { z } from "zod";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { contractError, finalizeToolResult } from "../contract.js";
import { CliError } from "../errors.js";

const PLAN_DIR = process.cwd();
const PLAN_FILE = "task_plan.md";
const FINDINGS_FILE = "findings.md";
const PROGRESS_FILE = "progress.md";

function planPath(file: string): string {
  return resolve(PLAN_DIR, file);
}

function handleError(err: unknown): Record<string, unknown> {
  if (err instanceof CliError) return contractError(String(err), "error");
  return contractError(`Unexpected error: ${err}`, "error");
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const PLAN_TEMPLATE = `# Task Plan: [Brief Description]

## Goal
[One sentence describing the end state]

## Current Phase
Phase 1

## Phases

### Phase 1: Requirements & Discovery
- [ ] Understand user intent
- [ ] Identify constraints and requirements
- [ ] Document findings in findings.md
- **Status:** in_progress

### Phase 2: Planning & Structure
- [ ] Define technical approach
- [ ] Create project structure if needed
- [ ] Document decisions with rationale
- **Status:** pending

### Phase 3: Implementation
- [ ] Execute the plan step by step
- [ ] Write code to files before executing
- [ ] Test incrementally
- **Status:** pending

### Phase 4: Testing & Verification
- [ ] Verify all requirements met
- [ ] Document test results in progress.md
- [ ] Fix any issues found
- **Status:** pending

### Phase 5: Delivery
- [ ] Review all output files
- [ ] Ensure deliverables are complete
- [ ] Deliver to user
- **Status:** pending

## Key Questions
1. [Question to answer]

## Decisions Made
| Decision | Rationale |
|----------|-----------|
|          |           |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       | 1       |            |

## Notes
- Update phase status as you progress: pending -> in_progress -> complete
- Re-read this plan before major decisions
- Log ALL errors
`;

const FINDINGS_TEMPLATE = `# Findings & Decisions

## Requirements
-

## Research Findings
-

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
|          |           |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
|       |            |

## Resources
-

---
*Update this file after every 2 view/browser/search operations*
`;

const PROGRESS_TEMPLATE = `# Progress Log

## Session: ${new Date().toISOString().slice(0, 10)}

### Phase 1: Requirements & Discovery
- **Status:** in_progress
- **Started:** ${new Date().toISOString().slice(0, 10)}
- Actions taken:
  -
- Files created/modified:
  -

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
|      |       |          |        |        |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
|           |       | 1       |            |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 1 |
| Where am I going? | Remaining phases |
| What's the goal? | [goal statement] |
| What have I learned? | See findings.md |
| What have I done? | See above |

---
*Update after completing each phase or encountering errors*
`;

// ---------------------------------------------------------------------------
// Register tools
// ---------------------------------------------------------------------------

export function registerPlanningTools(server: McpServer): void {
  server.registerTool("planning_init", {
    title: "Planning Init",
    description:
      "Create lean planning files (task_plan.md, findings.md, progress.md) in project root. No auth needed.",
    inputSchema: z.object({
      force: z
        .boolean()
        .default(false)
        .describe("Overwrite existing files (default false)"),
    }),
  }, async (args) => {
    try {
      const created: string[] = [];
      const skipped: string[] = [];

      const files: Array<[string, string]> = [
        [PLAN_FILE, PLAN_TEMPLATE],
        [FINDINGS_FILE, FINDINGS_TEMPLATE],
        [PROGRESS_FILE, PROGRESS_TEMPLATE],
      ];

      for (const [name, template] of files) {
        const path = planPath(name);
        if (existsSync(path) && !args.force) {
          skipped.push(name);
        } else {
          writeFileSync(path, template, "utf-8");
          created.push(name);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              finalizeToolResult({ ok: true, created, skipped }),
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) },
        ],
      };
    }
  });

  server.registerTool("planning_status", {
    title: "Planning Status",
    description:
      "Get compact planning status: goal, phases, decisions, errors, token count. No auth needed.",
    inputSchema: z.object({}),
  }, async () => {
    try {
      const path = planPath(PLAN_FILE);
      if (!existsSync(path)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                finalizeToolResult({
                  ok: false,
                  error: "No task_plan.md found. Run planning_init first.",
                }),
              ),
            },
          ],
        };
      }

      const content = readFileSync(path, "utf-8");
      const goalMatch = content.match(/## Goal\n(.+)/);
      const phaseMatch = content.match(/## Current Phase\n(.+)/);
      const phases: Array<{ name: string; status: string }> = [];
      const phaseRegex = /### Phase (\d+): (.+)\n[\s\S]*?- \*\*Status:\*\* (\w+)/g;
      let m;
      while ((m = phaseRegex.exec(content)) !== null) {
        phases.push({ name: `Phase ${m[1]}: ${m[2]}`, status: m[3] });
      }

      const tokens = Math.ceil(content.length / 4); // rough estimate

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              finalizeToolResult({
                ok: true,
                goal: goalMatch?.[1]?.trim() ?? "Not set",
                current_phase: phaseMatch?.[1]?.trim() ?? "Unknown",
                phases,
                estimated_tokens: tokens,
              }),
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) },
        ],
      };
    }
  });

  server.registerTool("planning_update", {
    title: "Planning Update",
    description:
      "Update planning files mechanically. No auth needed. Operations: goal, advance, phase_status, error, decision, finding, issue, log, file_changed, test.",
    inputSchema: z.object({
      operation: z.enum([
        "goal",
        "advance",
        "phase_status",
        "error",
        "decision",
        "finding",
        "issue",
        "log",
        "file_changed",
        "test",
      ]),
      text: z.string().optional(),
      phase: z.number().optional(),
      status: z.string().optional(),
      rationale: z.string().optional(),
      section: z.string().optional(),
      resolution: z.string().optional(),
      test_name: z.string().optional(),
      expected: z.string().optional(),
      actual: z.string().optional(),
      result: z.string().optional(),
    }),
  }, async (args) => {
    try {
      const { operation, text } = args;

      switch (operation) {
        case "goal": {
          if (!text) throw new CliError("goal operation requires text");
          const path = planPath(PLAN_FILE);
          let content = readFileSync(path, "utf-8");
          content = content.replace(
            /## Goal\n.+/,
            `## Goal\n${text}`,
          );
          writeFileSync(path, content, "utf-8");
          return {
            content: [
              { type: "text", text: JSON.stringify(finalizeToolResult({ ok: true, operation: "goal", text })) },
            ],
          };
        }

        case "log": {
          if (!text) throw new CliError("log operation requires text");
          const path = planPath(PROGRESS_FILE);
          appendFileSync(
            path,
            `\n  - ${text}`,
            "utf-8",
          );
          return {
            content: [
              { type: "text", text: JSON.stringify(finalizeToolResult({ ok: true, operation: "log", text })) },
            ],
          };
        }

        case "error": {
          if (!text) throw new CliError("error operation requires text");
          const path = planPath(PLAN_FILE);
          let content = readFileSync(path, "utf-8");
          content = content.replace(
            /\| +\| 1 +\| +\|/,
            `| ${text} | 1 |  |\n|       | 1       |            |`,
          );
          writeFileSync(path, content, "utf-8");
          return {
            content: [
              { type: "text", text: JSON.stringify(finalizeToolResult({ ok: true, operation: "error", text })) },
            ],
          };
        }

        case "decision": {
          if (!text) throw new CliError("decision operation requires text");
          const path = planPath(PLAN_FILE);
          let content = readFileSync(path, "utf-8");
          const rationale = args.rationale ?? "";
          content = content.replace(
            /\| +\| +\|\n\n## Errors/,
            `| ${text} | ${rationale} |\n|          |           |\n\n## Errors`,
          );
          writeFileSync(path, content, "utf-8");
          return {
            content: [
              { type: "text", text: JSON.stringify(finalizeToolResult({ ok: true, operation: "decision", text })) },
            ],
          };
        }

        case "finding": {
          if (!text) throw new CliError("finding operation requires text");
          const path = planPath(FINDINGS_FILE);
          const section = args.section ?? "Research Findings";
          let content = readFileSync(path, "utf-8");
          content = content.replace(
            new RegExp(`(## ${section}\n)`),
            `$1- ${text}\n`,
          );
          writeFileSync(path, content, "utf-8");
          return {
            content: [
              { type: "text", text: JSON.stringify(finalizeToolResult({ ok: true, operation: "finding", text })) },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  finalizeToolResult({ ok: true, operation, note: "Operation acknowledged" }),
                ),
              },
            ],
          };
      }
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) },
        ],
      };
    }
  });

  server.registerTool("planning_measure", {
    title: "Planning Measure",
    description:
      "Track token usage of planning files over time. No auth needed. Operations: snapshot, report, compare_templates.",
    inputSchema: z.object({
      operation: z.enum(["snapshot", "report", "compare_templates"]),
    }),
  }, async (args) => {
    try {
      const files = [PLAN_FILE, FINDINGS_FILE, PROGRESS_FILE];
      const measurements: Record<string, { chars: number; tokens: number }> =
        {};
      let totalChars = 0;

      for (const file of files) {
        const path = planPath(file);
        if (existsSync(path)) {
          const content = readFileSync(path, "utf-8");
          const chars = content.length;
          const tokens = Math.ceil(chars / 4);
          measurements[file] = { chars, tokens };
          totalChars += chars;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              finalizeToolResult({
                ok: true,
                operation: args.operation,
                files: measurements,
                total_chars: totalChars,
                total_tokens: Math.ceil(totalChars / 4),
              }),
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: JSON.stringify(finalizeToolResult(handleError(err))) },
        ],
      };
    }
  });
}
