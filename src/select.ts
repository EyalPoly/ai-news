import { PODCAST_CANDIDATE_POOL, PODCAST_MAX_PER_SOURCE, PODCAST_TOP_N } from "./config.js";
import type { ExtractedItem, ScoredItem } from "./types.js";

/**
 * Rank descending, then id ascending. The secondary key matters: ranks tie
 * constantly (a real week had a nine-way tie at 8.5), and without it selection
 * fell through to Array.sort stability — i.e. feed arrival order — so re-runs
 * could produce different episodes. `publishedAt` would read better but is not
 * recoverable from the committed digest.
 */
export function byRankThenId(a: ScoredItem, b: ScoredItem): number {
  if (b.rank !== a.rank) return b.rank - a.rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function candidatePool(items: ScoredItem[], size = PODCAST_CANDIDATE_POOL): ScoredItem[] {
  return [...items].sort(byRankThenId).slice(0, size);
}

/** Highest-ranked extractable items, no more than `maxPerSource` from any one feed. */
export function pickEpisodeItems(
  extracted: ExtractedItem[],
  topN = PODCAST_TOP_N,
  maxPerSource = PODCAST_MAX_PER_SOURCE,
): ExtractedItem[] {
  const usable = extracted.filter((i) => i.text !== null).sort(byRankThenId);
  const perSource = new Map<string, number>();
  const picked: ExtractedItem[] = [];

  for (const candidate of usable) {
    if (picked.length >= topN) break;
    const used = perSource.get(candidate.source) ?? 0;
    if (used >= maxPerSource) continue;
    perSource.set(candidate.source, used + 1);
    picked.push(candidate);
  }

  return picked;
}
