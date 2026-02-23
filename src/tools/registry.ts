/**
 * Registry tools — tag and lane registries (local, no API needed).
 * Provides the sanctioned taxonomy for agents.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { finalizeToolResult } from "../contract.js";

// ---------------------------------------------------------------------------
// Tag definitions (mirrors codecks_cli/tags.py)
// ---------------------------------------------------------------------------

interface TagDefinition {
  name: string;
  displayName: string;
  category: "system" | "discipline";
  description: string;
}

const TAGS: TagDefinition[] = [
  {
    name: "feature",
    displayName: "Feature",
    category: "system",
    description: "New functionality",
  },
  {
    name: "bug",
    displayName: "Bug",
    category: "system",
    description: "Defect to fix",
  },
  {
    name: "chore",
    displayName: "Chore",
    category: "system",
    description: "Maintenance task",
  },
  {
    name: "spike",
    displayName: "Spike",
    category: "system",
    description: "Research/investigation",
  },
  {
    name: "code",
    displayName: "Code",
    category: "discipline",
    description: "Programming work",
  },
  {
    name: "design",
    displayName: "Design",
    category: "discipline",
    description: "Visual/UX design",
  },
  {
    name: "art",
    displayName: "Art",
    category: "discipline",
    description: "Art assets",
  },
  {
    name: "audio",
    displayName: "Audio",
    category: "discipline",
    description: "Sound/music",
  },
];

const HERO_TAGS = new Set(["feature", "bug", "chore", "spike"]);
const LANE_TAGS: Record<string, string[]> = {
  code: ["code"],
  design: ["design"],
  art: ["art"],
  audio: ["audio"],
};

// ---------------------------------------------------------------------------
// Lane definitions (mirrors codecks_cli/lanes.py)
// ---------------------------------------------------------------------------

interface LaneDefinition {
  name: string;
  displayName: string;
  required: boolean;
  keywords: string[];
  defaultChecklist: string[];
  tags: string[];
  cliHelp: string;
}

const LANES: LaneDefinition[] = [
  {
    name: "code",
    displayName: "Code",
    required: true,
    keywords: ["programming", "implementation", "backend", "frontend"],
    defaultChecklist: ["- [] Implementation", "- [] Unit tests", "- [] Code review"],
    tags: ["code"],
    cliHelp: "Destination deck for Code sub-cards",
  },
  {
    name: "design",
    displayName: "Design",
    required: true,
    keywords: ["ui", "ux", "wireframe", "mockup", "layout"],
    defaultChecklist: ["- [] Wireframes", "- [] Visual design", "- [] Design review"],
    tags: ["design"],
    cliHelp: "Destination deck for Design sub-cards",
  },
  {
    name: "art",
    displayName: "Art",
    required: false,
    keywords: ["sprite", "texture", "model", "animation", "illustration"],
    defaultChecklist: ["- [] Concept art", "- [] Asset creation", "- [] Art review"],
    tags: ["art"],
    cliHelp: "Destination deck for Art sub-cards (optional)",
  },
  {
    name: "audio",
    displayName: "Audio",
    required: false,
    keywords: ["sound", "music", "sfx", "voice"],
    defaultChecklist: ["- [] Sound design", "- [] Implementation", "- [] Audio review"],
    tags: ["audio"],
    cliHelp: "Destination deck for Audio sub-cards (optional)",
  },
];

// ---------------------------------------------------------------------------
// Register tools
// ---------------------------------------------------------------------------

export function registerRegistryTools(server: McpServer): void {
  server.registerTool(
    "get_tag_registry",
    {
      title: "Get Tag Registry",
      description:
        "Get the local tag taxonomy (definitions, hero tags, lane-tag mappings). No auth needed.",
      inputSchema: z.object({
        category: z
          .enum(["system", "discipline"])
          .optional()
          .describe("Filter to system or discipline tags only"),
      }),
    },
    async (args) => {
      let tags = TAGS;
      if (args.category) {
        tags = tags.filter((t) => t.category === args.category);
      }

      const tagDicts = tags.map((t) => ({
        name: t.name,
        display_name: t.displayName,
        category: t.category,
        description: t.description,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              finalizeToolResult({
                tags: tagDicts,
                count: tagDicts.length,
                hero_tags: [...HERO_TAGS],
                lane_tags: LANE_TAGS,
              }),
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_lane_registry",
    {
      title: "Get Lane Registry",
      description: "Get the local lane (deck category) definitions and metadata. No auth needed.",
      inputSchema: z.object({
        required_only: z.boolean().default(false).describe("If true, return only required lanes"),
      }),
    },
    async (args) => {
      let lanes = LANES;
      if (args.required_only) {
        lanes = lanes.filter((l) => l.required);
      }

      const laneDicts = lanes.map((l) => ({
        name: l.name,
        display_name: l.displayName,
        required: l.required,
        keywords: l.keywords,
        default_checklist: l.defaultChecklist,
        tags: l.tags,
        cli_help: l.cliHelp,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              finalizeToolResult({
                lanes: laneDicts,
                count: laneDicts.length,
                required_lanes: LANES.filter((l) => l.required).map((l) => l.name),
                optional_lanes: LANES.filter((l) => !l.required).map((l) => l.name),
              }),
            ),
          },
        ],
      };
    },
  );
}
