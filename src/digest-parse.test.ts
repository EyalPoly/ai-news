import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDigest } from "./digest-parse.js";
import { renderDigest } from "./render.js";
import { blendRank } from "./score.js";
import { contentHash } from "./fetch.js";
import type { ScoredItem } from "./types.js";

function scored(p: Partial<ScoredItem>): ScoredItem {
  const tier = p.tier ?? "learning";
  const weight = p.weight ?? 5;
  const relevance = p.relevance ?? 8;
  return {
    id: p.id ?? contentHash(p.link ?? "https://x/1", p.title ?? "Title"),
    title: p.title ?? "Title",
    link: p.link ?? "https://x/1",
    source: p.source ?? "Simon Willison",
    tier,
    weight,
    publishedAt: p.publishedAt ?? 0,
    relevance,
    category: p.category ?? "engineering",
    rank: p.rank ?? blendRank(relevance, tier, weight),
  };
}

test("parseDigest round-trips everything renderDigest emits", () => {
  const items = [
    scored({ title: "Claude Opus 5", link: "https://anthropic.com/news/x", source: "Simon Willison", category: "model-release", relevance: 9, tier: "learning", weight: 5 }),
    scored({ title: "Some Agent Paper", link: "https://arxiv.org/abs/2607.1", source: "arXiv cs.AI agents", category: "agents-tooling", relevance: 7, tier: "awareness", weight: 1 }),
    scored({ title: "Latent Space Episode", link: "https://latent.space/p/x", source: "Latent Space", category: "ecosystem", relevance: 6, tier: "learning", weight: 4 }),
  ];

  const parsed = parseDigest(renderDigest(items, "2026-08-03"));

  assert.equal(parsed.length, 3);
  for (const original of items) {
    const found = parsed.find((p) => p.link === original.link);
    assert.ok(found, `missing ${original.link}`);
    assert.equal(found.title, original.title);
    assert.equal(found.source, original.source);
    assert.equal(found.relevance, original.relevance);
    assert.equal(found.category, original.category);
    assert.equal(found.tier, original.tier);
    assert.equal(found.weight, original.weight);
    assert.equal(found.rank, original.rank);
    assert.equal(found.id, original.id);
  }
});

test("parseDigest handles a title containing a closing bracket", () => {
  const items = [scored({ title: "A [weird] title", link: "https://x/9", source: "Latent Space", tier: "learning", weight: 4 })];
  const parsed = parseDigest(renderDigest(items, "2026-08-03"));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.title, "A [weird] title");
  assert.equal(parsed[0]?.link, "https://x/9");
});

test("parseDigest skips items whose source is no longer in SOURCES", () => {
  const markdown = [
    "# AI/Agents Digest — 2026-08-03",
    "",
    "## Engineering",
    "",
    "- [Gone](https://x/1)",
    "  *Retired Feed · relevance 8/10*",
    "- [Kept](https://x/2)",
    "  *Latent Space · relevance 8/10*",
    "",
  ].join("\n");

  const parsed = parseDigest(markdown);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.title, "Kept");
});

test("parseDigest returns nothing for an empty digest", () => {
  assert.deepEqual(parseDigest(renderDigest([], "2026-08-03")), []);
});
