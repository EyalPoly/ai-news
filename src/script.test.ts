import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScriptPrompt,
  parseScript,
  sanitizeSpokenText,
  segmentWords,
  validateScript,
  wordCount,
} from "./script.js";
import type { ExtractedItem, ParsedScript } from "./types.js";

function extracted(p: Partial<ExtractedItem>): ExtractedItem {
  return {
    id: p.id ?? "a", title: p.title ?? "Claude Opus 5", link: p.link ?? "https://x/1",
    source: p.source ?? "HN", tier: "awareness", weight: 2, publishedAt: 0,
    relevance: 9, category: "model-release", rank: 10,
    text: p.text ?? "Anthropic released a new model with a larger context window.",
  };
}

const GOOD = [
  "TITLE: Opus 5 lands and OneCLI locks down agent secrets",
  "SUMMARY: Two releases worth your afternoon.",
  "[[ITEM 1]]",
  "Maya: Anthropic shipped Opus 5 this week.",
  "Daniel: The context window is the headline for me.",
  "[[ITEM 2]]",
  "Maya: OneCLI is a credential gateway for agents.",
  "Daniel: It keeps secrets out of the model's context entirely.",
].join("\n");

test("wordCount counts whitespace-separated words", () => {
  assert.equal(wordCount("  one two   three "), 3);
  assert.equal(wordCount(""), 0);
});

test("parseScript reads TITLE, SUMMARY and segmented turns", () => {
  const script = parseScript(GOOD, "2026-08-03");
  assert.equal(script.title, "Opus 5 lands and OneCLI locks down agent secrets");
  assert.equal(script.summary, "Two releases worth your afternoon.");
  assert.equal(script.segments.length, 2);
  assert.equal(script.segments[0]?.index, 1);
  assert.deepEqual(script.segments[0]?.turns.map((t) => t.speaker), ["Maya", "Daniel"]);
  assert.equal(script.segments[1]?.turns[0]?.text, "OneCLI is a credential gateway for agents.");
});

test("parseScript falls back to a dated title when TITLE is missing", () => {
  const script = parseScript(GOOD.split("\n").slice(1).join("\n"), "2026-08-03");
  assert.equal(script.title, "AI/Agents Digest — 2026-08-03");
});

test("parseScript falls back when TITLE is too long", () => {
  const long = `TITLE: ${"x".repeat(150)}\n${GOOD.split("\n").slice(1).join("\n")}`;
  assert.equal(parseScript(long, "2026-08-03").title, "AI/Agents Digest — 2026-08-03");
});

test("parseScript drops lines with no recognized speaker prefix", () => {
  const messy = [
    "TITLE: t", "SUMMARY: s", "[[ITEM 1]]",
    "Maya: A real line.",
    "Narrator: not one of our hosts",
    "just some prose with no prefix at all",
    "Daniel: Another real line.",
  ].join("\n");
  const script = parseScript(messy, "2026-08-03");
  assert.deepEqual(script.segments[0]?.turns.map((t) => t.speaker), ["Maya", "Daniel"]);
});

test("parseScript throws when there are no segments at all", () => {
  assert.throws(() => parseScript("TITLE: t\nSUMMARY: s\n", "2026-08-03"), /no segments/);
});

test("sanitizeSpokenText strips stage directions, markdown and URLs", () => {
  assert.equal(sanitizeSpokenText("(laughs) That's **big** news"), "That's big news");
  assert.equal(sanitizeSpokenText("[intro music] Welcome back"), "Welcome back");
  assert.equal(sanitizeSpokenText("Find it at https://github.com/a/b today"), "Find it at today");
  assert.equal(sanitizeSpokenText("## A heading"), "A heading");
});

test("parseScript sanitizes turn text", () => {
  const dirty = "TITLE: t\nSUMMARY: s\n[[ITEM 1]]\nMaya: (laughing) See **https://x.com/a** for more.";
  const turn = parseScript(dirty, "2026-08-03").segments[0]?.turns[0];
  assert.equal(turn?.text, "See for more.");
});

test("segmentWords counts across all turns in a segment", () => {
  const script = parseScript(GOOD, "2026-08-03");
  assert.equal(segmentWords(script.segments[0]!), 6 + 8);
});

function scriptWith(wordsPerSegment: number[]): ParsedScript {
  return {
    title: "t",
    summary: "s",
    segments: wordsPerSegment.map((n, i) => ({
      index: i + 1,
      turns: [{ speaker: "Maya", text: Array.from({ length: n }, () => "word").join(" ") }],
    })),
  };
}

test("validateScript reports a segment below the minimum", () => {
  const violations = validateScript(scriptWith([200, 40]), 2);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /segment 2 is 40 words.*minimum is 110/);
});

test("validateScript reports a segment above the maximum", () => {
  const violations = validateScript(scriptWith([200, 400]), 2);
  assert.match(violations[0]!, /segment 2 is 400 words.*maximum is 300/);
});

test("validateScript reports a missing item marker", () => {
  const violations = validateScript(scriptWith([200, 200]), 3);
  assert.ok(violations.some((v) => /missing.*\[\[ITEM 3\]\]/.test(v)));
});

test("validateScript passes a well-formed script", () => {
  assert.deepEqual(validateScript(scriptWith([150, 200, 120]), 3), []);
});

test("buildScriptPrompt includes every item, its text, and the word budget", () => {
  const prompt = buildScriptPrompt(
    [extracted({ title: "Claude Opus 5" }), extracted({ id: "b", title: "OneCLI", text: "A gateway." })],
    "2026-08-03",
  );
  assert.match(prompt, /Maya/);
  assert.match(prompt, /Daniel/);
  assert.match(prompt, /\[\[ITEM 1\]\]/);
  assert.match(prompt, /Claude Opus 5/);
  assert.match(prompt, /OneCLI/);
  assert.match(prompt, /A gateway\./);
  assert.match(prompt, /110/);
  assert.match(prompt, /300/);
  assert.match(prompt, /2026-08-03/);
});
