import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAll, extractArticle, readableText } from "./extract.js";
import type { ScoredItem } from "./types.js";

const ARTICLE_HTML = `<!doctype html><html><head><title>A Real Post</title></head><body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <article><h1>A Real Post</h1>
    ${"<p>This is a substantial paragraph of article body text that readability should keep.</p>".repeat(12)}
  </article>
  <footer>Copyright</footer></body></html>`;

function htmlResponse(body: string, init: { status?: number; type?: string } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "text/html; charset=utf-8" },
  });
}

function scored(p: Partial<ScoredItem>): ScoredItem {
  return {
    id: p.id ?? "a", title: p.title ?? "t", link: p.link ?? "https://x/1",
    source: p.source ?? "S", tier: "awareness", weight: 1, publishedAt: 0,
    relevance: 8, category: "engineering", rank: 8.5,
  };
}

test("readableText strips navigation and keeps article body", () => {
  const text = readableText(ARTICLE_HTML);
  assert.ok(text);
  assert.match(text, /substantial paragraph of article body text/);
  assert.doesNotMatch(text, /Copyright/);
});

test("extractArticle returns text on a good HTML response", async () => {
  const result = await extractArticle("https://x/1", async () => htmlResponse(ARTICLE_HTML));
  assert.equal(result.failure, undefined);
  assert.ok(result.text && result.text.length >= 400);
});

test("extractArticle truncates to EXTRACT_MAX_CHARS", async () => {
  const huge = `<html><body><article>${"<p>word word word word word.</p>".repeat(5000)}</article></body></html>`;
  const result = await extractArticle("https://x/1", async () => htmlResponse(huge));
  assert.ok(result.text);
  assert.equal(result.text.length, 6000);
});

test("extractArticle reports an HTTP error status", async () => {
  const result = await extractArticle("https://x/1", async () => htmlResponse("nope", { status: 403 }));
  assert.equal(result.text, null);
  assert.equal(result.failure, "http-403");
});

test("extractArticle rejects a non-HTML content type", async () => {
  const result = await extractArticle("https://x/1", async () => htmlResponse("%PDF-1.4", { type: "application/pdf" }));
  assert.equal(result.text, null);
  assert.equal(result.failure, "content-type:application/pdf");
});

test("extractArticle reports a timeout", async () => {
  const result = await extractArticle("https://x/1", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    throw err;
  });
  assert.equal(result.text, null);
  assert.equal(result.failure, "timeout");
});

test("extractArticle rejects text below EXTRACT_MIN_CHARS", async () => {
  const thin = "<html><body><article><p>Too short.</p></article></body></html>";
  const result = await extractArticle("https://x/1", async () => htmlResponse(thin));
  assert.equal(result.text, null);
  assert.match(String(result.failure), /^too-short:/);
});

test("extractArticle rejects an oversized response", async () => {
  const big = new Response("x".repeat(10), {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "9000000" },
  });
  const result = await extractArticle("https://x/1", async () => big);
  assert.equal(result.text, null);
  assert.equal(result.failure, "too-large");
});

test("extractAll preserves item order and attaches text or failure", async () => {
  const items = [scored({ id: "a", link: "https://good/1" }), scored({ id: "b", link: "https://bad/1" })];
  const results = await extractAll(items, async (input) =>
    String(input).includes("good") ? htmlResponse(ARTICLE_HTML) : htmlResponse("no", { status: 500 }),
  );
  assert.deepEqual(results.map((r) => r.id), ["a", "b"]);
  assert.ok(results[0]?.text);
  assert.equal(results[1]?.text, null);
  assert.equal(results[1]?.failure, "http-500");
});
