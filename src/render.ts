import { CATEGORIES, CATEGORY_TITLES, RELEVANCE_THRESHOLD } from "./config.js";
import type { Category, ScoredItem } from "./types.js";

function renderItem(item: ScoredItem): string {
  const footnote = `*${item.source} · relevance ${item.relevance}/10*`;
  return `- [${item.title}](${item.link}) — ${item.summary}\n  ${footnote}`;
}

/** Markdown digest grouped by category, threshold-filtered, dated. */
export function renderDigest(items: ScoredItem[], date: string): string {
  const kept = items.filter((i) => i.relevance >= RELEVANCE_THRESHOLD);
  const lines: string[] = [`# AI/Agents Digest — ${date}`, ""];

  if (kept.length === 0) {
    lines.push("_No items cleared the relevance threshold this week._");
    return `${lines.join("\n")}\n`;
  }

  const byCategory = new Map<Category, ScoredItem[]>();
  for (const item of kept) {
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push(item);
    byCategory.set(item.category, bucket);
  }

  for (const category of CATEGORIES) {
    const bucket = byCategory.get(category);
    if (!bucket || bucket.length === 0) continue;
    lines.push(`## ${CATEGORY_TITLES[category]}`, "");
    for (const item of bucket) lines.push(renderItem(item));
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
