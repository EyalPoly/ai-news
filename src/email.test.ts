import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml } from "./email.js";

test("markdownToHtml renders headings and links", () => {
  const html = markdownToHtml("# Title\n\n## Section\n\n- [Name](https://x/1) — note\n  *src · relevance 7/10*");
  assert.match(html, /<h1[^>]*>Title<\/h1>/);
  assert.match(html, /<h2[^>]*>Section<\/h2>/);
  assert.match(html, /<a [^>]*href="https:\/\/x\/1"[^>]*>Name<\/a>/);
});

test("markdownToHtml escapes raw HTML in text", () => {
  const html = markdownToHtml("# A <script>alert(1)</script>");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("markdownToHtml is unchanged by the podcast work", () => {
  const html = markdownToHtml("# T\n\n- [A](https://x/1)");
  assert.match(html, /<h1[^>]*>T<\/h1>/);
  assert.match(html, /href="https:\/\/x\/1"/);
});
