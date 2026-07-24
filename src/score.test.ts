import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blendRank,
  capForBudget,
  isRetryableStatus,
  parseScores,
  preScorePriority,
  rankAndSort,
  RetryableError,
  withRetry,
} from "./score.js";
import type { FeedItem } from "./types.js";

function item(p: Partial<FeedItem>): FeedItem {
  return {
    id: p.id ?? "1", title: p.title ?? "t", link: p.link ?? "https://x/1",
    source: p.source ?? "s", tier: p.tier ?? "tools", weight: p.weight ?? 1,
    publishedAt: p.publishedAt ?? 0,
  };
}

test("parseScores accepts a {scores:[...]} object", () => {
  const raw = '{"scores":[{"relevance":7,"category":"engineering"}]}';
  const out = parseScores(raw, 1);
  assert.equal(out[0]?.relevance, 7);
  assert.equal(out[0]?.category, "engineering");
});

test("parseScores strips ```json fences before parsing", () => {
  const raw = '```json\n{"scores":[{"relevance":3,"category":"ecosystem"}]}\n```';
  assert.equal(parseScores(raw, 1).length, 1);
});

test("parseScores throws when there is no scores array", () => {
  const raw = '{"relevance":7,"category":"engineering"}';
  assert.throws(() => parseScores(raw, 1));
});

test("parseScores throws when the count does not match", () => {
  const raw = '{"scores":[{"relevance":7,"category":"engineering"}]}';
  assert.throws(() => parseScores(raw, 2));
});

test("parseScores clamps relevance and falls back on bad category", () => {
  const raw = '{"scores":[{"relevance":99,"category":"not-real"}]}';
  const out = parseScores(raw, 1);
  assert.equal(out[0]?.relevance, 10);
  assert.equal(out[0]?.category, "ecosystem"); // safe fallback
});

test("blendRank = relevance + tier priority + weight*0.5", () => {
  assert.equal(blendRank(7, "tools", 4), 7 + 2 + 2);       // 11
  assert.equal(blendRank(7, "awareness", 1), 7 + 0 + 0.5); // 7.5
});

test("preScorePriority ranks tools+high-weight above awareness+low-weight", () => {
  assert.ok(preScorePriority("tools", 5) > preScorePriority("awareness", 1));
});

test("capForBudget keeps the highest pre-score priority items up to the limit", () => {
  const items = [
    item({ id: "lo", tier: "awareness", weight: 1 }),
    item({ id: "hi", tier: "tools", weight: 5 }),
    item({ id: "mid", tier: "learning", weight: 3 }),
  ];
  assert.deepEqual(capForBudget(items, 2).map((i) => i.id), ["hi", "mid"]);
});

test("capForBudget is a no-op at or under the limit", () => {
  assert.equal(capForBudget([item({ id: "a" })], 10).length, 1);
});

test("rankAndSort sorts by blended rank descending", () => {
  const items = [item({ id: "a", tier: "awareness", weight: 1 }), item({ id: "b", tier: "tools", weight: 5 })];
  const scores = [
    { relevance: 8, category: "ecosystem" as const },
    { relevance: 8, category: "agents-tooling" as const },
  ];
  const out = rankAndSort(items, scores);
  assert.equal(out[0]?.id, "b"); // tools+weight5 outranks awareness+weight1 at equal relevance
});

test("isRetryableStatus is true for 429 and 5xx, false otherwise", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(200), false);
});

test("withRetry returns the result on first success without retrying", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry retries RetryableError up to `attempts` times then succeeds", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw new RetryableError("transient");
    return "ok";
  }, 3, 1);
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry does not retry a non-RetryableError", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw new Error("permanent");
    }, 3, 1),
    /permanent/,
  );
  assert.equal(calls, 1);
});

test("withRetry gives up after `attempts` and throws the last error", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw new RetryableError(`fail ${calls}`);
    }, 3, 1),
    /fail 3/,
  );
  assert.equal(calls, 3);
});
