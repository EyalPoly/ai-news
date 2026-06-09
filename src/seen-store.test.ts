import { test } from "node:test";
import assert from "node:assert/strict";
import { filterNew, prune, recordSeen } from "./seen-store.js";
import type { FeedItem, SeenStore } from "./seen-store.js";

function item(id: string): FeedItem {
  return { id, title: id, link: `https://x/${id}`, source: "s", tier: "tools", weight: 1, publishedAt: 0 };
}

test("filterNew returns only items absent from the store", () => {
  const store: SeenStore = { a: 1 };
  const out = filterNew([item("a"), item("b")], store);
  assert.deepEqual(out.map((i) => i.id), ["b"]);
});

test("recordSeen adds ids with the given timestamp without overwriting", () => {
  const store: SeenStore = { a: 100 };
  recordSeen([item("a"), item("b")], store, 200);
  assert.equal(store.a, 100); // unchanged
  assert.equal(store.b, 200);
});

test("prune drops entries older than the cutoff", () => {
  const now = 1_000_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const store: SeenStore = { old: now - 200 * day, fresh: now - 1 * day };
  const pruned = prune(store, now);
  assert.deepEqual(Object.keys(pruned), ["fresh"]);
});
