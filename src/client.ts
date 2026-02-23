/**
 * CodecksClient — TypeScript equivalent of codecks_cli/client.py + cards.py.
 * Wraps the Codecks HTTP API with typed methods for all MCP tool operations.
 *
 * IMPORTANT: Query format uses filter-in-key-name pattern matching the Codecks API.
 * e.g., cards({"status":"started","visibility":"default"}) as the property name.
 */

import { query, dispatch, reportRequest } from "./api.js";
import { config } from "./config.js";
import { CliError, SetupError } from "./errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getField(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj) return obj[key];
  }
  return undefined;
}

function parseIsoTimestamp(ts: unknown): Date | null {
  if (typeof ts !== "string") return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

/** Build filter-embedded key name: cards({"status":"started"}) */
function filteredKey(entity: string, filters: Record<string, unknown>): string {
  return `${entity}(${JSON.stringify(filters)})`;
}

/** Parse comma-separated values and validate against allowed set */
function parseMultiValue(value: string, allowed: Set<string>, label: string): string[] {
  const values = value.split(",").map((s) => s.trim());
  for (const v of values) {
    if (!allowed.has(v)) {
      throw new CliError(`[ERROR] Invalid ${label}: '${v}'. Valid: ${[...allowed].join(", ")}`);
    }
  }
  return values;
}

const VALID_STATUSES = new Set([
  "not_started",
  "started",
  "done",
  "blocked",
  "in_review",
  "in_progress",
]);

// ---------------------------------------------------------------------------
// CodecksClient
// ---------------------------------------------------------------------------

export class CodecksClient {
  // ---- Account ----

  async getAccount(): Promise<Record<string, unknown>> {
    const result = await query({
      _root: [{ account: ["name", "id"] }],
    });
    const acct = result.account as Record<string, unknown> | undefined;
    if (!acct) throw new SetupError("[TOKEN_EXPIRED] Could not fetch account.");
    return result;
  }

  // ---- Cards ----

  async listCards(
    options: {
      deck?: string;
      status?: string;
      project?: string;
      search?: string;
      milestone?: string;
      tag?: string;
      owner?: string;
      priority?: string;
      sort?: string;
      cardType?: string;
      hero?: string;
      handOnly?: boolean;
      staleDays?: number;
      updatedAfter?: string;
      updatedBefore?: string;
      archived?: boolean;
      includeStats?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Record<string, unknown>> {
    const cardFields: unknown[] = [
      "title",
      "status",
      "priority",
      "deckId",
      "effort",
      "createdAt",
      "milestoneId",
      "masterTags",
      "lastUpdatedAt",
      "isDoc",
      "childCardInfo",
      { assignee: ["name", "id"] },
    ];
    if (options.search) cardFields.push("content");

    // Build server-side filter
    const cardQuery: Record<string, unknown> = {
      visibility: options.archived ? "archived" : "default",
    };

    // Parse and apply status filter (single value = server-side)
    let clientStatusFilter: string[] | null = null;
    if (options.status) {
      const statuses = parseMultiValue(options.status, VALID_STATUSES, "status");
      if (statuses.length === 1) {
        cardQuery.status = statuses[0];
      } else {
        clientStatusFilter = statuses;
      }
    }

    // Resolve deck filter to ID
    if (options.deck) {
      const decksResult = await this.listDecks();
      const decks = (decksResult.decks ?? []) as Record<string, unknown>[];
      const deck = decks.find(
        (d) => String(d.title ?? "").toLowerCase() === options.deck!.toLowerCase(),
      );
      if (deck) {
        cardQuery.deckId = deck.id;
      } else {
        throw new CliError(`[ERROR] Deck '${options.deck}' not found.`);
      }
    }

    const q = {
      _root: [{ account: [{ [filteredKey("cards", cardQuery)]: cardFields }] }],
    };

    const result = await query(q);
    let cards = this.extractCards(result);

    // Client-side filtering
    if (clientStatusFilter) {
      const allowed = new Set(clientStatusFilter);
      cards = cards.filter((c) => allowed.has(String(c.status ?? "")));
    }
    if (options.search) {
      const term = options.search.toLowerCase();
      cards = cards.filter(
        (c) =>
          String(c.title ?? "")
            .toLowerCase()
            .includes(term) ||
          String(c.content ?? "")
            .toLowerCase()
            .includes(term),
      );
    }
    if (options.owner) {
      if (options.owner === "none") {
        cards = cards.filter((c) => !c.assignee);
      } else {
        const name = options.owner.toLowerCase();
        cards = cards.filter((c) => {
          const assignee = c.assignee as Record<string, unknown> | undefined;
          return assignee && String(assignee.name ?? "").toLowerCase() === name;
        });
      }
    }
    if (options.staleDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.staleDays);
      cards = cards.filter((c) => {
        const updated = parseIsoTimestamp(c.lastUpdatedAt);
        return updated && updated < cutoff;
      });
    }

    // Sort
    if (options.sort) {
      const sortField = options.sort;
      const reverse = sortField === "updated" || sortField === "created";
      cards.sort((a, b) => {
        const va = String(getField(a, sortField) ?? "");
        const vb = String(getField(b, sortField) ?? "");
        return reverse ? vb.localeCompare(va) : va.localeCompare(vb);
      });
    }

    const stats = options.includeStats ? this.computeStats(cards) : null;
    return { cards, stats, count: cards.length };
  }

  async getCard(
    cardId: string,
    options: {
      includeContent?: boolean;
      includeConversations?: boolean;
      archived?: boolean;
    } = {},
  ): Promise<Record<string, unknown>> {
    const { includeContent = true, includeConversations = true } = options;
    const visibility = options.archived ? "archived" : "default";

    const cardFields: unknown[] = [
      "title",
      "status",
      "priority",
      "deckId",
      "effort",
      "createdAt",
      "milestoneId",
      "masterTags",
      "lastUpdatedAt",
      "isDoc",
      "childCardInfo",
      { assignee: ["name", "id"] },
      { parentCard: ["title"] },
      { childCards: ["title", "status"] },
    ];
    if (includeContent) cardFields.push("content");
    if (includeConversations) {
      cardFields.push({
        resolvables: [
          "context",
          "isClosed",
          "createdAt",
          { creator: ["name"] },
          { entries: ["content", "createdAt", { author: ["name"] }] },
        ],
      });
    }

    const cardFilter = { cardId, visibility };
    const q = {
      _root: [{ account: [{ [filteredKey("cards", cardFilter)]: cardFields }] }],
    };

    const result = await query(q);
    const cards = this.extractCards(result);
    if (cards.length === 0) {
      throw new CliError(`[ERROR] Card not found: ${cardId}`);
    }
    return cards[0];
  }

  // ---- Decks ----

  async listDecks(): Promise<Record<string, unknown>> {
    const result = await query({
      _root: [{ account: [{ decks: ["title", "id", "projectId"] }] }],
    });
    const decks = this.extractList(result, "decks");
    return { decks };
  }

  // ---- Projects ----

  async listProjects(): Promise<Record<string, unknown>> {
    const result = await query({
      _root: [
        {
          account: [{ projects: ["id", "title", { decks: ["id", "title"] }] }],
        },
      ],
    });
    return { projects: this.extractList(result, "projects") };
  }

  // ---- Milestones ----

  async listMilestones(): Promise<Record<string, unknown>> {
    const result = await query({
      _root: [{ account: [{ milestones: ["id", "title"] }] }],
    });
    return { milestones: this.extractList(result, "milestones") };
  }

  // ---- Tags ----

  async listTags(): Promise<Record<string, unknown>> {
    const result = await query({
      _root: [{ account: [{ masterTags: ["title", "id", "color", "emoji"] }] }],
    });
    return { tags: this.extractList(result, "masterTags") };
  }

  // ---- Activity ----

  async listActivity(limit = 20): Promise<Record<string, unknown>> {
    const result = await query({
      _root: [
        {
          account: [
            {
              activities: [
                "type",
                "createdAt",
                "data",
                { card: ["title"] },
                { changer: ["name"] },
                { deck: ["title"] },
              ],
            },
          ],
        },
      ],
    });
    let entries = this.extractList(result, "activities");
    entries = entries.slice(0, limit);
    return { entries, count: entries.length };
  }

  // ---- PM Focus ----

  async pmFocus(
    options: {
      project?: string;
      owner?: string;
      limit?: number;
      staleDays?: number;
    } = {},
  ): Promise<Record<string, unknown>> {
    const { limit = 5, staleDays = 14 } = options;
    const all = await this.listCards({
      status: "not_started,started,blocked,in_review",
      project: options.project,
      owner: options.owner,
    });
    const cards = (all.cards ?? []) as Record<string, unknown>[];

    const blocked = cards.filter((c) => c.status === "blocked").slice(0, limit);
    const inReview = cards.filter((c) => c.status === "in_review").slice(0, limit);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);
    const stale = cards
      .filter((c) => {
        const updated = parseIsoTimestamp(c.lastUpdatedAt);
        return updated && updated < cutoff && c.status !== "blocked";
      })
      .slice(0, limit);

    return {
      counts: {
        total: cards.length,
        blocked: blocked.length,
        in_review: inReview.length,
        stale: stale.length,
      },
      blocked,
      in_review: inReview,
      stale,
      suggested: cards.filter((c) => c.status === "not_started").slice(0, limit),
    };
  }

  // ---- Standup ----

  async standup(
    options: {
      days?: number;
      project?: string;
      owner?: string;
    } = {},
  ): Promise<Record<string, unknown>> {
    const { days = 2 } = options;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const all = await this.listCards({
      project: options.project,
      owner: options.owner,
    });
    const cards = (all.cards ?? []) as Record<string, unknown>[];

    return {
      recently_done: cards
        .filter((c) => c.status === "done" && parseIsoTimestamp(c.lastUpdatedAt)! >= cutoff)
        .slice(0, 10),
      in_progress: cards.filter((c) => c.status === "started").slice(0, 10),
      blocked: cards.filter((c) => c.status === "blocked").slice(0, 10),
      hand: [],
    };
  }

  // ---- Hand ----

  async listHand(): Promise<Record<string, unknown>[]> {
    const result = await query({
      _root: [{ account: [{ queueEntries: ["card", "sortIndex", "user"] }] }],
    });
    return this.extractList(result, "queueEntries");
  }

  async addToHand(cardIds: string[]): Promise<Record<string, unknown>> {
    const userId = config.userId;
    if (!userId)
      throw new CliError("[ERROR] CODECKS_USER_ID not set. Required for hand operations.");

    const result = await dispatch("handQueue/setCardOrders", {
      sessionId: crypto.randomUUID(),
      userId,
      cardIds,
      draggedCardIds: cardIds,
    });
    return { ok: true, added: cardIds.length, result };
  }

  async removeFromHand(cardIds: string[]): Promise<Record<string, unknown>> {
    const result = await dispatch("handQueue/removeCards", {
      sessionId: crypto.randomUUID(),
      cardIds,
    });
    return { ok: true, removed: cardIds.length, result };
  }

  // ---- Mutations ----

  async createCard(options: {
    title: string;
    content?: string;
    deck?: string;
    project?: string;
    severity?: string;
    doc?: boolean;
    allowDuplicate?: boolean;
    parent?: string;
  }): Promise<Record<string, unknown>> {
    const fullContent = `# ${options.title}${options.content ? "\n\n" + options.content : ""}`;

    const result = await reportRequest(fullContent, {
      severity: options.severity,
    });

    const cardId = String(
      (result as Record<string, unknown>).id ??
        (result as Record<string, unknown>).cardId ??
        "unknown",
    );

    return { ok: true, card_id: cardId, title: options.title };
  }

  async updateCards(options: {
    cardIds: string[];
    status?: string;
    priority?: string;
    effort?: string;
    deck?: string;
    title?: string;
    content?: string;
    milestone?: string;
    hero?: string;
    owner?: string;
    tags?: string;
    doc?: string;
    continueOnError?: boolean;
  }): Promise<Record<string, unknown>> {
    const results: Record<string, unknown>[] = [];
    let updated = 0;

    for (const cardId of options.cardIds) {
      const payload: Record<string, unknown> = { id: cardId };
      if (options.status) payload.status = options.status;
      if (options.priority) {
        payload.priority = options.priority === "null" ? null : options.priority;
      }
      if (options.effort) {
        payload.effort = options.effort === "null" ? null : parseInt(options.effort, 10);
      }
      if (options.title) payload.title = options.title;
      if (options.content !== undefined) payload.content = options.content;
      if (options.milestone) {
        payload.milestoneId = options.milestone === "null" ? null : options.milestone;
      }
      if (options.owner) {
        payload.assigneeId = options.owner === "null" ? null : options.owner;
      }

      try {
        const r = await dispatch("cards/update", payload);
        results.push({ card_id: cardId, ok: true, result: r });
        updated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ card_id: cardId, ok: false, error: msg });
        if (!options.continueOnError) break;
      }
    }

    return { ok: updated > 0, updated, results };
  }

  async markDone(cardIds: string[]): Promise<Record<string, unknown>> {
    return this.updateCards({ cardIds, status: "done" });
  }

  async markStarted(cardIds: string[]): Promise<Record<string, unknown>> {
    return this.updateCards({ cardIds, status: "started" });
  }

  async archiveCard(cardId: string): Promise<Record<string, unknown>> {
    const result = await dispatch("cards/update", {
      id: cardId,
      visibility: "archived",
    });
    return { ok: true, card_id: cardId, result };
  }

  async unarchiveCard(cardId: string): Promise<Record<string, unknown>> {
    const result = await dispatch("cards/update", {
      id: cardId,
      visibility: "default",
    });
    return { ok: true, card_id: cardId, result };
  }

  async deleteCard(cardId: string): Promise<Record<string, unknown>> {
    // Two-step: archive first, then delete
    await dispatch("cards/update", { id: cardId, visibility: "archived" });
    const result = await dispatch("cards/bulkUpdate", {
      ids: [cardId],
      visibility: "deleted",
      deleteFiles: false,
    });
    return { ok: true, card_id: cardId, result };
  }

  // ---- Scaffolding (simplified) ----

  async scaffoldFeature(options: {
    title: string;
    heroDeck: string;
    codeDeck: string;
    designDeck: string;
    artDeck?: string;
    skipArt?: boolean;
    audioDeck?: string;
    skipAudio?: boolean;
    description?: string;
    owner?: string;
    priority?: string;
    effort?: number;
    allowDuplicate?: boolean;
  }): Promise<Record<string, unknown>> {
    const hero = await this.createCard({
      title: options.title,
      content: options.description,
      doc: false,
    });

    const heroId = hero.card_id as string;
    const subcards: Record<string, unknown>[] = [];

    const lanes = [
      { name: "Code", deck: options.codeDeck },
      { name: "Design", deck: options.designDeck },
    ];
    if (!options.skipArt && options.artDeck) {
      lanes.push({ name: "Art", deck: options.artDeck });
    }
    if (!options.skipAudio && options.audioDeck) {
      lanes.push({ name: "Audio", deck: options.audioDeck });
    }

    for (const lane of lanes) {
      const sub = await this.createCard({
        title: `${options.title} - ${lane.name}`,
        parent: heroId,
      });
      subcards.push({ lane: lane.name, card_id: sub.card_id });
    }

    return {
      ok: true,
      hero_id: heroId,
      title: options.title,
      subcards,
    };
  }

  async splitFeatures(options: {
    deck: string;
    codeDeck: string;
    designDeck: string;
    artDeck?: string;
    skipArt?: boolean;
    audioDeck?: string;
    skipAudio?: boolean;
    priority?: string;
    dryRun?: boolean;
  }): Promise<Record<string, unknown>> {
    const all = await this.listCards({ deck: options.deck });
    const cards = (all.cards ?? []) as Record<string, unknown>[];
    const features = cards.filter((c) => {
      const info = c.childCardInfo as Record<string, unknown> | undefined;
      return !info || (info.count ?? 0) === 0;
    });

    if (options.dryRun) {
      return {
        ok: true,
        dry_run: true,
        features_found: features.length,
        features: features.map((f) => ({ id: f.id, title: f.title })),
      };
    }

    let processed = 0;
    const details: Record<string, unknown>[] = [];

    for (const feature of features) {
      try {
        const result = await this.scaffoldFeature({
          title: feature.title as string,
          heroDeck: options.deck,
          codeDeck: options.codeDeck,
          designDeck: options.designDeck,
          artDeck: options.artDeck,
          skipArt: options.skipArt,
          audioDeck: options.audioDeck,
          skipAudio: options.skipAudio,
          priority: options.priority,
        });
        details.push(result);
        processed++;
      } catch (err) {
        details.push({
          ok: false,
          title: feature.title,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ok: true,
      features_processed: processed,
      features_skipped: features.length - processed,
      details,
    };
  }

  // ---- Comments ----

  async createComment(cardId: string, message: string): Promise<Record<string, unknown>> {
    const userId = config.userId;
    if (!userId) throw new CliError("[ERROR] CODECKS_USER_ID not set.");

    const result = await dispatch("resolvables/create", {
      cardId,
      userId,
      content: message,
      context: "comment",
    });
    return { ok: true, card_id: cardId, result };
  }

  async replyComment(threadId: string, message: string): Promise<Record<string, unknown>> {
    const userId = config.userId;
    if (!userId) throw new CliError("[ERROR] CODECKS_USER_ID not set.");

    const result = await dispatch("resolvables/comment", {
      resolvableId: threadId,
      content: message,
      authorId: userId,
    });
    return { ok: true, thread_id: threadId, result };
  }

  async closeComment(threadId: string, cardId: string): Promise<Record<string, unknown>> {
    const userId = config.userId;
    if (!userId) throw new CliError("[ERROR] CODECKS_USER_ID not set.");

    const result = await dispatch("resolvables/close", {
      id: threadId,
      isClosed: true,
      cardId,
      closedBy: userId,
    });
    return { ok: true, thread_id: threadId, result };
  }

  async reopenComment(threadId: string, cardId: string): Promise<Record<string, unknown>> {
    const result = await dispatch("resolvables/reopen", {
      id: threadId,
      isClosed: false,
      cardId,
    });
    return { ok: true, thread_id: threadId, result };
  }

  async listConversations(cardId: string): Promise<Record<string, unknown>> {
    const cardFilter = { cardId, visibility: "default" };
    const result = await query({
      _root: [
        {
          account: [
            {
              [filteredKey("cards", cardFilter)]: [
                "title",
                {
                  resolvables: [
                    "context",
                    "isClosed",
                    "createdAt",
                    { creator: ["name"] },
                    { entries: ["content", "createdAt", { author: ["name"] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    return result;
  }

  // ---- Internal helpers ----

  private extractCards(result: Record<string, unknown>): Record<string, unknown>[] {
    // Codecks returns { card: { <uuid>: {...}, <uuid>: {...} } }
    return this.extractEntityMap(result, "card");
  }

  private extractList(
    result: Record<string, unknown>,
    queryKey: string,
  ): Record<string, unknown>[] {
    // Query key is plural (decks, milestones), response key is singular (deck, milestone)
    // Try singular first, then plural as fallback
    const singularKey = queryKey.replace(/s$/, "").replace(/ie$/, "y");
    return (
      this.extractEntityMap(result, singularKey) || this.extractEntityMap(result, queryKey) || []
    );
  }

  private extractEntityMap(
    result: Record<string, unknown>,
    key: string,
  ): Record<string, unknown>[] {
    const entityMap = result[key] as Record<string, unknown> | undefined;
    if (entityMap && typeof entityMap === "object" && !Array.isArray(entityMap)) {
      return Object.values(entityMap).filter((v) => typeof v === "object" && v !== null) as Record<
        string,
        unknown
      >[];
    }
    return [];
  }

  private computeStats(cards: Record<string, unknown>[]): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const card of cards) {
      const status = String(card.status ?? "unknown");
      stats[status] = (stats[status] ?? 0) + 1;
    }
    return stats;
  }
}
