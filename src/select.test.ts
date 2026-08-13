import { test } from "node:test";
import assert from "node:assert/strict";
import { byRankThenId, candidatePool, pickEpisodeItems } from "./select.js";
import type { ExtractedItem, ScoredItem } from "./types.js";

function item(p: Partial<ExtractedItem>): ExtractedItem {
  return {
    id: p.id ?? "a",
    title: p.title ?? "t",
    link: p.link ?? "https://x/1",
    source: p.source ?? "S1",
    tier: p.tier ?? "awareness",
    weight: p.weight ?? 1,
    publishedAt: 0,
    relevance: p.relevance ?? 8,
    category: p.category ?? "engineering",
    rank: p.rank ?? 8.5,
    text: p.text === undefined ? "body text" : p.text,
    failure: p.failure,
  };
}

test("byRankThenId sorts by rank descending, then id ascending", () => {
  const sorted = [
    item({ id: "c", rank: 8.5 }),
    item({ id: "a", rank: 8.5 }),
    item({ id: "b", rank: 10 }),
  ].sort(byRankThenId);
  assert.deepEqual(sorted.map((i) => i.id), ["b", "a", "c"]);
});

test("candidatePool takes the highest-ranked N deterministically", () => {
  const items: ScoredItem[] = [
    item({ id: "d", rank: 7 }),
    item({ id: "a", rank: 9 }),
    item({ id: "c", rank: 8 }),
    item({ id: "b", rank: 9 }),
  ];
  assert.deepEqual(candidatePool(items, 3).map((i) => i.id), ["a", "b", "c"]);
});

test("pickEpisodeItems drops items whose extraction failed", () => {
  const picked = pickEpisodeItems(
    [
      item({ id: "a", rank: 10, text: null, failure: "http-403" }),
      item({ id: "b", rank: 9 }),
      item({ id: "c", rank: 8 }),
    ],
    8,
    3,
  );
  assert.deepEqual(picked.map((i) => i.id), ["b", "c"]);
});

test("pickEpisodeItems enforces the per-source cap", () => {
  const arxiv = ["a", "b", "c", "d", "e"].map((id, n) =>
    item({ id, source: "arXiv cs.AI agents", rank: 9 - n * 0.01 }),
  );
  const others = [
    item({ id: "x", source: "Simon Willison", rank: 8 }),
    item({ id: "y", source: "Latent Space", rank: 7.9 }),
  ];

  const picked = pickEpisodeItems([...arxiv, ...others], 8, 3);

  assert.equal(picked.filter((i) => i.source === "arXiv cs.AI agents").length, 3);
  assert.deepEqual(picked.map((i) => i.id), ["a", "b", "c", "x", "y"]);
});

test("pickEpisodeItems never returns more than topN", () => {
  const many = Array.from({ length: 20 }, (_, n) =>
    item({ id: `id${String(n).padStart(2, "0")}`, source: `S${n}`, rank: 10 - n * 0.1 }),
  );
  assert.equal(pickEpisodeItems(many, 8, 3).length, 8);
});

test("pickEpisodeItems is deterministic across shuffles of the same input", () => {
  const base = ["a", "b", "c", "d"].map((id) => item({ id, source: `S-${id}`, rank: 8.5 }));
  const forward = pickEpisodeItems(base, 3, 3).map((i) => i.id);
  const reversed = pickEpisodeItems([...base].reverse(), 3, 3).map((i) => i.id);
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, ["a", "b", "c"]);
});
