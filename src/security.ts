/**
 * Security layer: injection detection, output tagging, input validation.
 * Direct port of the Python mcp_server.py security section.
 */

import { CliError } from "./errors.js";

// ---------------------------------------------------------------------------
// Injection detection
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/^(system|assistant|user)\s*:/im, "role label"],
  [
    /<\s*\/?\s*(system|instruction|admin|prompt|tool_call|function_call)/i,
    "XML-like directive tag",
  ],
  [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
    "override directive",
  ],
  [
    /forget\s+(your|all|the)\s+(rules|instructions|training|guidelines)/i,
    "forget directive",
  ],
  [
    /you\s+are\s+now\s+(in\s+)?(admin|root|debug|developer|unrestricted|jailbreak)/i,
    "mode switching",
  ],
  [
    /(execute|call|invoke|run)\s+the\s+(tool|function|command)/i,
    "tool invocation directive",
  ],
];

export function checkInjection(text: string): string[] {
  if (text.length < 10) return [];
  return INJECTION_PATTERNS.filter(([pattern]) => pattern.test(text)).map(
    ([, desc]) => desc,
  );
}

// ---------------------------------------------------------------------------
// Output tagging
// ---------------------------------------------------------------------------

export function tagUserText(text: string | null | undefined): string | null {
  if (text == null) return null;
  return `[USER_DATA]${text}[/USER_DATA]`;
}

const USER_TEXT_FIELDS = new Set([
  "title",
  "content",
  "deck_name",
  "owner_name",
  "milestone_name",
]);

export function sanitizeCard(
  card: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...card };
  const warnings: string[] = [];

  for (const field of USER_TEXT_FIELDS) {
    if (field in out && typeof out[field] === "string") {
      for (const desc of checkInjection(out[field] as string)) {
        warnings.push(`${field}: ${desc}`);
      }
      out[field] = tagUserText(out[field] as string);
    }
  }

  if (Array.isArray(out.sub_cards)) {
    out.sub_cards = (out.sub_cards as Record<string, unknown>[]).map((sc) => {
      const tagged = { ...sc };
      if (typeof tagged.title === "string") {
        for (const desc of checkInjection(tagged.title as string)) {
          warnings.push(`sub_card.title: ${desc}`);
        }
        tagged.title = tagUserText(tagged.title as string);
      }
      return tagged;
    });
  }

  if (Array.isArray(out.conversations)) {
    out.conversations = (out.conversations as Record<string, unknown>[]).map(
      (conv) => {
        const tagged = { ...conv };
        if (Array.isArray(tagged.messages)) {
          tagged.messages = (tagged.messages as Record<string, unknown>[]).map(
            (msg) => {
              const m = { ...msg };
              if (typeof m.content === "string") {
                for (const desc of checkInjection(m.content as string)) {
                  warnings.push(`conversation.message: ${desc}`);
                }
                m.content = tagUserText(m.content as string);
              }
              return m;
            },
          );
        }
        return tagged;
      },
    );
  }

  if (warnings.length > 0) {
    out._safety_warnings = warnings;
  }

  return out;
}

export function sanitizeActivity(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...data };
  if (out.cards && typeof out.cards === "object" && !Array.isArray(out.cards)) {
    const cards = out.cards as Record<string, Record<string, unknown>>;
    const tagged: Record<string, Record<string, unknown>> = {};
    for (const [id, card] of Object.entries(cards)) {
      const c = { ...card };
      if (typeof c.title === "string") {
        c.title = tagUserText(c.title as string);
      }
      tagged[id] = c;
    }
    out.cards = tagged;
  }
  return out;
}

export function sanitizeConversations(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...data };
  for (const [key, val] of Object.entries(out)) {
    if (Array.isArray(val)) {
      out[key] = val.map((item) => {
        if (typeof item === "object" && item !== null) {
          const m = { ...item } as Record<string, unknown>;
          if (typeof m.content === "string") {
            m.content = tagUserText(m.content as string);
          }
          return m;
        }
        return item;
      });
    } else if (typeof val === "object" && val !== null) {
      const entries = val as Record<string, Record<string, unknown>>;
      const tagged: Record<string, Record<string, unknown>> = {};
      for (const [id, entry] of Object.entries(entries)) {
        const e = { ...entry };
        if (typeof e.content === "string") {
          e.content = tagUserText(e.content as string);
        }
        tagged[id] = e;
      }
      out[key] = tagged;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

const INPUT_LIMITS: Record<string, number> = {
  title: 500,
  content: 50_000,
  message: 10_000,
  observation: 500,
  description: 50_000,
  feedback_message: 1000,
  feedback_context: 500,
};

export function validateInput(text: string, field: string): string {
  if (typeof text !== "string") {
    throw new CliError(`[ERROR] ${field} must be a string`);
  }
  const cleaned = text.replace(CONTROL_RE, "");
  const limit = INPUT_LIMITS[field] ?? 50_000;
  if (cleaned.length > limit) {
    throw new CliError(
      `[ERROR] ${field} exceeds maximum length of ${limit} characters`,
    );
  }
  return cleaned;
}

export function validateUuid(value: string, field = "card_id"): string {
  if (
    typeof value !== "string" ||
    value.length !== 36 ||
    (value.match(/-/g) ?? []).length !== 4
  ) {
    throw new CliError(
      `[ERROR] ${field} must be a full 36-char UUID, got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export function validateUuidList(
  values: string[],
  field = "card_ids",
): string[] {
  return values.map((v) => validateUuid(v, field));
}
