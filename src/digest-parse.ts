import { CATEGORIES, CATEGORY_TITLES } from "./config.js";
import { contentHash } from "./fetch.js";
import { blendRank } from "./score.js";
import { SOURCES } from "./sources.js";
import type { Category, ScoredItem } from "./types.js";

const CATEGORY_BY_TITLE = new Map<string, Category>(
  CATEGORIES.map((c) => [CATEGORY_TITLES[c], c]),
);
const SOURCE_BY_NAME = new Map(SOURCES.map((s) => [s.name, s]));

// Greedy title group so a title containing "]" still parses; render.ts does no escaping.
const ITEM_RE = /^- \[(.+)\]\((https?:[^)]+)\)$/;
const NOTE_RE = /^\*(.+) · relevance (\d+)\/10\*$/;

/**
 * Inverse of render.ts. `publishedAt` is not recoverable from the markdown and
 * is set to 0 — selection tie-breaks on `id` instead, which is stable.
 */
export function parseDigest(markdown: string): ScoredItem[] {
  const out: ScoredItem[] = [];
  let category: Category = "ecosystem";
  let pending: { title: string; link: string } | null = null;

  for (const raw of markdown.split("\n")) {
    const line = raw.trim();

    if (line.startsWith("## ")) {
      category = CATEGORY_BY_TITLE.get(line.slice(3)) ?? category;
      pending = null;
      continue;
    }

    const itemMatch = ITEM_RE.exec(line);
    if (itemMatch) {
      pending = { title: itemMatch[1] as string, link: itemMatch[2] as string };
      continue;
    }

    if (!pending) continue;
    const noteMatch = NOTE_RE.exec(line);
    if (!noteMatch) continue;

    const sourceName = noteMatch[1] as string;
    const relevance = Number(noteMatch[2]);
    const source = SOURCE_BY_NAME.get(sourceName);

    if (source) {
      out.push({
        id: contentHash(pending.link, pending.title),
        title: pending.title,
        link: pending.link,
        source: sourceName,
        tier: source.tier,
        weight: source.weight,
        publishedAt: 0,
        relevance,
        category,
        rank: blendRank(relevance, source.tier, source.weight),
      });
    } else {
      console.warn(`[digest-parse] unknown source "${sourceName}" — skipping "${pending.title}"`);
    }
    pending = null;
  }

  return out;
}
