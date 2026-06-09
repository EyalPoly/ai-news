import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, dedupeByHash } from "./fetch.js";
import type { FeedItem } from "./types.js";

function item(partial: Partial<FeedItem>): FeedItem {
  return {
    id: partial.id ?? contentHash(partial.link ?? "", partial.title ?? ""),
    title: partial.title ?? "t",
    link: partial.link ?? "https://x/1",
    source: partial.source ?? "s",
    tier: partial.tier ?? "tools",
    weight: partial.weight ?? 1,
    publishedAt: partial.publishedAt ?? 0,
  };
}

test("contentHash is stable and order-sensitive on inputs", () => {
  assert.equal(contentHash("a", "b"), contentHash("a", "b"));
  assert.notEqual(contentHash("a", "b"), contentHash("b", "a"));
});

test("dedupeByHash keeps the higher-weight source on collision", () => {
  const low = item({ link: "https://x/1", title: "T", source: "low", weight: 1 });
  const high = item({ link: "https://x/1", title: "T", source: "high", weight: 5 });
  const out = dedupeByHash([low, high]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.source, "high");
});

test("dedupeByHash keeps distinct items", () => {
  const a = item({ link: "https://x/1", title: "A" });
  const b = item({ link: "https://x/2", title: "B" });
  assert.equal(dedupeByHash([a, b]).length, 2);
});
