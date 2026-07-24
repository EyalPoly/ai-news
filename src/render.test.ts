import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDigest } from "./render.js";
import type { ScoredItem } from "./types.js";

function scored(p: Partial<ScoredItem>): ScoredItem {
  return {
    id: p.id ?? "1", title: p.title ?? "Title", link: p.link ?? "https://x/1",
    source: p.source ?? "Src", tier: p.tier ?? "tools", weight: p.weight ?? 1,
    publishedAt: p.publishedAt ?? 0, relevance: p.relevance ?? 8,
    category: p.category ?? "engineering",
    rank: p.rank ?? 8,
  };
}

test("renderDigest drops items below the relevance threshold", () => {
  const md = renderDigest([scored({ title: "Keep", relevance: 8 }), scored({ id: "2", title: "Drop", relevance: 2 })], "2026-06-09");
  assert.match(md, /Keep/);
  assert.doesNotMatch(md, /Drop/);
});

test("renderDigest groups by category heading and links titles", () => {
  const md = renderDigest([scored({ title: "Rel", category: "model-release", link: "https://x/r" })], "2026-06-09");
  assert.match(md, /# AI\/Agents Digest — 2026-06-09/);
  assert.match(md, /## Model Releases/);
  assert.match(md, /\[Rel\]\(https:\/\/x\/r\)/);
});

test("renderDigest reports an empty digest gracefully", () => {
  const md = renderDigest([], "2026-06-09");
  assert.match(md, /# AI\/Agents Digest — 2026-06-09/);
  assert.match(md, /No items/i);
});
