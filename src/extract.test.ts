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

test("readableText returns null on a document Readability rejects outright", () => {
  // Readability throws here rather than returning null; if that escaped,
  // Promise.all in extractAll would lose the whole batch over one bad page.
  for (const html of ["", "   ", '{"items":[]}']) {
    assert.equal(readableText(html), null);
  }
});

test("readableText bails out on a deeply nested document instead of hanging", () => {
  // The actual hang shape: 1,803 elements in 21KB — 1% of EXTRACT_MAX_BYTES and
  // under the element ceiling, so only the depth check can catch it. Measured at
  // 27s through Readability without the guard; the assertion below is what keeps
  // a regression here from turning into a wedged weekly run.
  const html = `<html><body>${"<div>".repeat(1800)}<p>${"prose ".repeat(200)}</p>${"</div>".repeat(1800)}</body></html>`;

  const started = Date.now();
  const text = readableText(html);
  const elapsed = Date.now() - started;

  assert.equal(text, null);
  assert.ok(elapsed < 1000, `expected a fast bail-out, took ${elapsed}ms`);
});

test("readableText bails out on a document over the DOM-element ceiling", () => {
  // The other axis: shallow, so depth cannot catch it, and ~18k elements of real
  // prose that Readability parses happily — a null can only be the count ceiling.
  const paragraph = "<p>Real article prose that readability would happily extract if it ran.</p>";
  const block = `<div><section><article>${paragraph.repeat(20)}</article></section></div>`;
  const html = `<html><body>${block.repeat(800)}</body></html>`;

  const started = Date.now();
  const text = readableText(html);
  const elapsed = Date.now() - started;

  assert.equal(text, null);
  assert.ok(elapsed < 3000, `expected a fast bail-out, took ${elapsed}ms`);
});

test("readableText still accepts a large real-world-shaped page", () => {
  // Sized against pages measured from this repo's own digests, which run to
  // 3,364 elements (a HuggingFace post) and 8,417 (a long Wikipedia article) at
  // depth 25-28: ~5,000 elements of prose with inline links and code, wrapped in
  // the layout divs a real CMS emits. A ceiling tuned on toy fixtures alone would
  // silently cut extraction rate on exactly this shape.
  const paragraph =
    '<p>Prose with an <a href="/x">inline link</a> and some <code>agent_loop()</code> in it. </p>';
  const wrap = 25;
  const html = `<html><body>${"<div>".repeat(wrap)}<article><h1>Title</h1>${paragraph.repeat(
    1200,
  )}</article>${"</div>".repeat(wrap)}</body></html>`;

  const text = readableText(html);
  assert.ok(text && text.length > 20_000, `expected real text, got ${text?.length ?? "null"}`);
});

test("extractArticle maps an empty HTML body to unparseable rather than throwing", async () => {
  const result = await extractArticle("https://x/1", async () => htmlResponse(""));
  assert.deepEqual(result, { text: null, failure: "unparseable" });
});

test("extractArticle returns text on a good HTML response", async () => {
  const result = await extractArticle("https://x/1", async () => htmlResponse(ARTICLE_HTML));
  assert.equal(result.failure, undefined);
  assert.ok(result.text && result.text.length >= 400);
});

test("extractArticle truncates to EXTRACT_MAX_CHARS", async () => {
  // Long paragraphs rather than many of them: the text has to exceed 6000 chars
  // while the element count stays inside readableText's ceiling, as a real
  // article of this length does.
  const paragraph = `<p>${"word ".repeat(60)}</p>`;
  const huge = `<html><body><article>${paragraph.repeat(200)}</article></body></html>`;
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

test("extractAll turns an unexpected throw into one item's failure, not the batch's", async () => {
  const exploding = htmlResponse("<html><body><p>x</p></body></html>");
  Object.defineProperty(exploding, "text", {
    value: async () => {
      throw new Error("boom");
    },
  });

  const items = [scored({ id: "a", link: "https://good/1" }), scored({ id: "b", link: "https://bad/1" })];
  const results = await extractAll(items, async (input) =>
    String(input).includes("good") ? htmlResponse(ARTICLE_HTML) : exploding,
  );

  assert.ok(results[0]?.text);
  assert.equal(results[1]?.text, null);
  assert.equal(results[1]?.failure, "extract-error");
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
