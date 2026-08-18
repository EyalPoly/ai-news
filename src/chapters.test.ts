import { test } from "node:test";
import assert from "node:assert/strict";
import { computeChapters } from "./chapters.js";
import type { ExtractedItem, ParsedScript, Segment } from "./types.js";

function words(n: number, word = "w"): string {
  return Array.from({ length: n }, () => word).join(" ");
}

function segment(index: number, wordCounts: number[]): Segment {
  return {
    index,
    turns: wordCounts.map((n, i) => ({
      speaker: i % 2 === 0 ? "Maya" : "Daniel",
      text: words(n),
    })),
  };
}

function item(p: Partial<ExtractedItem>): ExtractedItem {
  return {
    id: p.id ?? "a",
    title: p.title ?? "t",
    link: p.link ?? "https://x/1",
    source: p.source ?? "S",
    tier: p.tier ?? "awareness",
    weight: p.weight ?? 1,
    publishedAt: 0,
    relevance: 8,
    category: "engineering",
    rank: 8.5,
    text: p.text === undefined ? "body" : p.text,
  };
}

test("computeChapters splits duration proportionally by word count", () => {
  const script: ParsedScript = {
    title: "T",
    summary: "S",
    segments: [segment(1, [40]), segment(2, [60])],
  };
  const items = [item({ title: "First" }), item({ title: "Second" })];

  const chapters = computeChapters(script, items, 100);

  assert.deepEqual(chapters, [
    { title: "First", startMs: 0, endMs: 40000 },
    { title: "Second", startMs: 40000, endMs: 100000 },
  ]);
});

test("computeChapters maps titles by segment.index into the items array", () => {
  const script: ParsedScript = {
    title: "T",
    summary: "S",
    segments: [segment(1, [10]), segment(2, [10])],
  };
  const items = [item({ title: "Alpha" }), item({ title: "Beta" })];

  const chapters = computeChapters(script, items, 10);

  assert.equal(chapters[0]?.title, "Alpha");
  assert.equal(chapters[1]?.title, "Beta");
});

test("computeChapters falls back to a placeholder title when the item is missing", () => {
  const script: ParsedScript = {
    title: "T",
    summary: "S",
    segments: [segment(2, [10])],
  };

  const chapters = computeChapters(script, [], 10);

  assert.equal(chapters[0]?.title, "Item 2");
});

test("computeChapters returns an empty array for a script with no segments", () => {
  const script: ParsedScript = { title: "T", summary: "S", segments: [] };
  assert.deepEqual(computeChapters(script, [], 100), []);
});

test("computeChapters chapters are contiguous with no gaps or overlaps", () => {
  const script: ParsedScript = {
    title: "T",
    summary: "S",
    segments: [segment(1, [7]), segment(2, [13]), segment(3, [5])],
  };
  const items = [item({ title: "A" }), item({ title: "B" }), item({ title: "C" })];

  const chapters = computeChapters(script, items, 610.7);

  assert.equal(chapters[0]?.startMs, 0);
  assert.equal(chapters[1]?.startMs, chapters[0]?.endMs);
  assert.equal(chapters[2]?.startMs, chapters[1]?.endMs);
});

test("computeChapters closes the last chapter exactly at the measured duration despite rounding", () => {
  const script: ParsedScript = {
    title: "T",
    summary: "S",
    segments: [segment(1, [37]), segment(2, [52]), segment(3, [44])],
  };
  const items = [item({ title: "A" }), item({ title: "B" }), item({ title: "C" })];

  const chapters = computeChapters(script, items, 610.7);

  assert.equal(chapters[chapters.length - 1]?.endMs, Math.round(610.7 * 1000));
});