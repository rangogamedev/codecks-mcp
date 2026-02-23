/**
 * CodecksClient — TypeScript equivalent of codecks_cli/client.py.
 * Wraps the Codecks HTTP API with typed methods for all MCP tool operations.
 */

import { query, dispatch } from "./api.js";
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

// ---------------------------------------------------------------------------
// CodecksClient
// ---------------------------------------------------------------------------

export class CodecksClient {
  // ---- Account ----

  async getAccount(): Promise<Record<string, unknown>> {
    const result = await query({
      _root: [{ account: ["id", "name", "email", "role"] }],
    });
    const acct = result.account as Record<string, unknown> | undefined;
    if (!acct) throw new SetupError("[TOKEN_EXPIRED] Could not fetch account.");
    return acct;
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
    } = {},
  ): Promise<Record<string, unknown>> {
    // Build query filters
    const filters: Record<string, unknown> = {};
    if (options.status) {
      const statuses = options.status.split(",").map((s) => s.trim());
      filters.status = statuses.length === 1 ? statuses[0] : statuses;
    }
    if (options.priority) {
      const pris = options.priority.split(",").map((p) => p.trim());
      filters.priority = pris.length === 1 ? pris[0] : pris;
    }
    if (options.cardType === "hero") filters.cardType = "hero";
    if (options.cardType === "doc") filters.cardType = "doc";
    if (options.archived) filters.visibility = "archived";

    const cardFields = [
      "id",
      "title",
      "status",
      "priority",
      "effort",
      "createdAt",
      "lastUpdatedAt",
      { assignee: ["name"] },
      { deck: ["title"] },
      { milestone: ["title"] },
      { masterTags: ["name"] },
    ];

    const q: Record<string, unknown> = {
      _root: [
        {
          account: [
            {
              [`${options.archived ? "archivedCards" : "cards"}`]: cardFields,
            },
          ],
        },
      ],
    };

    const result = await query(q);
    let cards = this.extractCards(result);

    // Client-side filtering
    if (options.deck) {
      cards = cards.filter(
        (c) =>
          String(getField(c, "deck_name", "deckName") ?? "").toLowerCase() ===
          options.deck!.toLowerCase(),
      );
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
        cards = cards.filter((c) => !c.owner_name);
      } else {
        const name = options.owner.toLowerCase();
        cards = cards.filter(
          (c) => String(c.owner_name ?? "").toLowerCase() === name,
        );
      }
    }
    if (options.staleDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.staleDays);
      cards = cards.filter((c) => {
        const updated = parseIsoTimestamp(
          getField(c, "last_updated_at", "lastUpdatedAt"),
        );
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
    return { cards, stats };
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

    const fields: unknown[] = [
      "id",
      "title",
      "status",
      "priority",
      "effort",
      "createdAt",
      "lastUpdatedAt",
      { assignee: ["name"] },
      { deck: ["title"] },
      { milestone: ["title"] },
      { masterTags: ["name"] },
      { childCards: ["id", "title", "status"] },
    ];
    if (includeContent) fields.push("content");

    const result = await query({
      card: { _args: { id: cardId }, _fields: fields },
    });

    const card = (result.card ?? result[cardId]) as Record<string, unknown>;
    if (!card) throw new CliError(`[ERROR] Card not found: ${cardId}`);

    return this.enrichCard(card, { includeContent, includeConversations });
  }

  // ---- Decks ----

  async listDecks(includeCardCounts = false): Promise<Record<string, unknown>> {
    const fields: unknown[] = ["id", "title"];
    if (includeCardCounts) fields.push({ cards: ["id"] });

    const result = await query({
      _root: [{ account: [{ decks: fields }] }],
    });
    const decks = this.extractList(result, "decks");
    return {
      decks: decks.map((d) => ({
        ...d,
        card_count: Array.isArray(d.cards)
          ? (d.cards as unknown[]).length
          : undefined,
      })),
    };
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
      _root: [{ account: [{ masterTags: ["id", "name", "color"] }] }],
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
              activityEntries: {
                _args: { limit },
                _fields: [
                  "id",
                  "type",
                  "createdAt",
                  { card: ["id", "title"] },
                  { user: ["name"] },
                ],
              },
            },
          ],
        },
      ],
    });
    return { entries: this.extractList(result, "activityEntries") };
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
    const inReview = cards
      .filter((c) => c.status === "in_review")
      .slice(0, limit);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);
    const stale = cards
      .filter((c) => {
        const updated = parseIsoTimestamp(
          getField(c, "last_updated_at", "lastUpdatedAt"),
        );
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
      suggested: cards
        .filter((c) => c.status === "not_started")
        .slice(0, limit),
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
        .filter(
          (c) =>
            c.status === "done" &&
            parseIsoTimestamp(
              getField(c, "last_updated_at", "lastUpdatedAt"),
            )! >= cutoff,
        )
        .slice(0, 10),
      in_progress: cards.filter((c) => c.status === "started").slice(0, 10),
      blocked: cards.filter((c) => c.status === "blocked").slice(0, 10),
      hand: [],
    };
  }

  // ---- Hand ----

  async listHand(): Promise<Record<string, unknown>[]> {
    const result = await query({
      _root: [
        {
          account: [
            {
              handCards: [
                "id",
                "title",
                "status",
                "priority",
                { deck: ["title"] },
              ],
            },
          ],
        },
      ],
    });
    return this.extractList(result, "handCards");
  }

  async addToHand(cardIds: string[]): Promise<Record<string, unknown>> {
    const results = [];
    for (const id of cardIds) {
      const r = await dispatch("hand-cards/add", { cardId: id });
      results.push(r);
    }
    return { ok: true, added: cardIds.length };
  }

  async removeFromHand(cardIds: string[]): Promise<Record<string, unknown>> {
    const results = [];
    for (const id of cardIds) {
      const r = await dispatch("hand-cards/remove", { cardId: id });
      results.push(r);
    }
    return { ok: true, removed: cardIds.length };
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
    const payload: Record<string, unknown> = {
      content: `# ${options.title}${options.content ? "\n\n" + options.content : ""}`,
    };
    if (options.severity && options.severity !== "null") {
      payload.severity = options.severity;
    }
    if (options.doc) payload.cardType = "doc";

    const result = await dispatch("cards/create", payload);
    const cardId =
      (result.payload as Record<string, unknown>)?.id ??
      result.cardId ??
      "unknown";

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
    const updates: Record<string, unknown> = {};
    if (options.status) updates.status = options.status;
    if (options.priority) {
      updates.priority = options.priority === "null" ? null : options.priority;
    }
    if (options.effort) {
      updates.effort =
        options.effort === "null" ? null : parseInt(options.effort, 10);
    }
    if (options.title) updates.title = options.title;
    if (options.content !== undefined) updates.content = options.content;

    const results: Record<string, unknown>[] = [];
    let updated = 0;

    for (const cardId of options.cardIds) {
      try {
        const r = await dispatch("cards/update", {
          cardId,
          update: updates,
        });
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
      cardId,
      update: { visibility: "archived" },
    });
    return { ok: true, card_id: cardId, result };
  }

  async unarchiveCard(cardId: string): Promise<Record<string, unknown>> {
    const result = await dispatch("cards/update", {
      cardId,
      update: { visibility: "default" },
    });
    return { ok: true, card_id: cardId, result };
  }

  async deleteCard(cardId: string): Promise<Record<string, unknown>> {
    const result = await dispatch("cards/remove", { cardId });
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
    // Create hero card
    const hero = await this.createCard({
      title: options.title,
      content: options.description,
      doc: false,
    });

    const heroId = hero.card_id as string;
    const subcards: Record<string, unknown>[] = [];

    // Create lane sub-cards
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
    // List cards in source deck, find unsplit features
    const all = await this.listCards({ deck: options.deck });
    const cards = (all.cards ?? []) as Record<string, unknown>[];
    const features = cards.filter(
      (c) =>
        !Array.isArray(c.sub_cards) || (c.sub_cards as unknown[]).length === 0,
    );

    if (options.dryRun) {
      return {
        ok: true,
        dry_run: true,
        features_found: features.length,
        features: features.map((f) => ({
          id: f.id,
          title: f.title,
        })),
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

  async createComment(
    cardId: string,
    message: string,
  ): Promise<Record<string, unknown>> {
    const result = await dispatch("card-conversations/create", {
      cardId,
      message,
    });
    return { ok: true, card_id: cardId, result };
  }

  async replyComment(
    threadId: string,
    message: string,
  ): Promise<Record<string, unknown>> {
    const result = await dispatch("card-conversation-messages/create", {
      conversationId: threadId,
      message,
    });
    return { ok: true, thread_id: threadId, result };
  }

  async closeComment(
    threadId: string,
    cardId: string,
  ): Promise<Record<string, unknown>> {
    const result = await dispatch("card-conversations/resolve", {
      conversationId: threadId,
      cardId,
    });
    return { ok: true, thread_id: threadId, result };
  }

  async reopenComment(
    threadId: string,
    cardId: string,
  ): Promise<Record<string, unknown>> {
    const result = await dispatch("card-conversations/unresolve", {
      conversationId: threadId,
      cardId,
    });
    return { ok: true, thread_id: threadId, result };
  }

  async listConversations(cardId: string): Promise<Record<string, unknown>> {
    const result = await query({
      card: {
        _args: { id: cardId },
        _fields: [
          {
            conversations: [
              "id",
              "status",
              { messages: ["id", "content", "createdAt", { user: ["name"] }] },
            ],
          },
        ],
      },
    });
    return result;
  }

  // ---- Internal helpers ----

  private extractCards(
    result: Record<string, unknown>,
  ): Record<string, unknown>[] {
    // Navigate the nested query response to find cards
    for (const val of Object.values(result)) {
      if (typeof val === "object" && val !== null) {
        const obj = val as Record<string, unknown>;
        if (Array.isArray(obj.cards))
          return obj.cards as Record<string, unknown>[];
        // Recurse one level
        for (const inner of Object.values(obj)) {
          if (typeof inner === "object" && inner !== null) {
            const innerObj = inner as Record<string, unknown>;
            if (Array.isArray(innerObj.cards))
              return innerObj.cards as Record<string, unknown>[];
          }
        }
      }
    }
    return [];
  }

  private extractList(
    result: Record<string, unknown>,
    key: string,
  ): Record<string, unknown>[] {
    for (const val of Object.values(result)) {
      if (typeof val === "object" && val !== null) {
        const obj = val as Record<string, unknown>;
        if (Array.isArray(obj[key]))
          return obj[key] as Record<string, unknown>[];
        for (const inner of Object.values(obj)) {
          if (typeof inner === "object" && inner !== null) {
            const innerObj = inner as Record<string, unknown>;
            if (Array.isArray(innerObj[key]))
              return innerObj[key] as Record<string, unknown>[];
          }
        }
      }
    }
    return [];
  }

  private enrichCard(
    card: Record<string, unknown>,
    _options: {
      includeContent?: boolean;
      includeConversations?: boolean;
    },
  ): Record<string, unknown> {
    // Flatten nested relations
    if (card.assignee && typeof card.assignee === "object") {
      card.owner_name = (card.assignee as Record<string, unknown>).name;
    }
    if (card.deck && typeof card.deck === "object") {
      card.deck_name = (card.deck as Record<string, unknown>).title;
    }
    if (card.milestone && typeof card.milestone === "object") {
      card.milestone_name = (card.milestone as Record<string, unknown>).title;
    }
    if (Array.isArray(card.masterTags)) {
      card.tags = (card.masterTags as Record<string, unknown>[]).map(
        (t) => t.name,
      );
    }
    if (Array.isArray(card.childCards)) {
      card.sub_cards = card.childCards;
    }
    return card;
  }

  private computeStats(
    cards: Record<string, unknown>[],
  ): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const card of cards) {
      const status = String(card.status ?? "unknown");
      stats[status] = (stats[status] ?? 0) + 1;
    }
    return stats;
  }
}
