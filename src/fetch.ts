import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { LOOKBACK_DAYS } from "./config.js";
import { SOURCES } from "./sources.js";
import type { FeedItem, Source } from "./types.js";

const parser = new Parser({ timeout: 20000 });

/** Stable dedup key from a feed entry's link and title. */
export function contentHash(link: string, title: string): string {
  return createHash("sha256").update(`${link}\n${title}`).digest("hex").slice(0, 16);
}

/** Collapse same-hash items, keeping the higher-weight source on collision. */
export function dedupeByHash(items: FeedItem[]): FeedItem[] {
  const byHash = new Map<string, FeedItem>();
  for (const item of items) {
    const existing = byHash.get(item.id);
    if (!existing || item.weight > existing.weight) {
      byHash.set(item.id, item);
    }
  }
  return [...byHash.values()];
}

function normalize(source: Source, entry: Parser.Item): FeedItem | null {
  const link = entry.link?.trim();
  const title = entry.title?.trim();
  if (!link || !title) return null;

  const dateStr = entry.isoDate ?? entry.pubDate;
  const publishedAt = dateStr ? Date.parse(dateStr) : NaN;
  // Items without a usable date can't be windowed; treat as "now" so they're not lost.
  const ts = Number.isNaN(publishedAt) ? Date.now() : publishedAt;

  return {
    id: contentHash(link, title),
    title,
    link,
    source: source.name,
    tier: source.tier,
    weight: source.weight,
    publishedAt: ts,
  };
}

async function fetchOne(source: Source, cutoff: number): Promise<FeedItem[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const items: FeedItem[] = [];
    for (const entry of feed.items ?? []) {
      const item = normalize(source, entry);
      if (item && item.publishedAt >= cutoff) items.push(item);
    }
    return items;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[fetch] skipping "${source.name}": ${reason}`);
    return [];
  }
}

/** Pull all feeds in parallel, window to the lookback period, dedupe the batch. */
export async function fetchAll(now = Date.now()): Promise<FeedItem[]> {
  const cutoff = now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const batches = await Promise.all(SOURCES.map((s) => fetchOne(s, cutoff)));
  return dedupeByHash(batches.flat());
}
