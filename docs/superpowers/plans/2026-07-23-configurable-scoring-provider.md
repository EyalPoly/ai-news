# Configurable Scoring Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `score.ts` support an OpenAI-compatible scoring endpoint (Gemini's free tier today, a self-hosted server later) as a configurable alternative to Anthropic, and drop the `summary` field that the scoring model currently generates from title alone.

**Architecture:** `score.ts` gains a provider split behind the same `BatchResult` shape it already returns internally, so everything downstream (`parseScores`, `rankAndSort`, `capForBudget`, `blendRank`) is untouched. A shared `withRetry` wrapper handles transient 429/5xx failures for both providers. The JSON contract sent to the model changes from a bare array to `{"scores": [...]}`, which is safer for servers that enforce `response_format: json_object`.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Node 20/22 built-in `fetch`, `node:test` for tests, `tsx` as the runner (no separate build step, no compile-time type checking during test runs — run `npm run typecheck` separately).

## Global Constraints

- ESM with `.js` import specifiers for local `.ts` files (e.g. `from "./config.js"`), matching every existing file in `src/`.
- Strict TS with `noUncheckedIndexedAccess`; run `npm run typecheck` after every task.
- Tests are flat `src/*.test.ts` files run by `node:test`; run a single file with `node --import tsx --test src/<file>.test.ts`, or everything with `npm test`.
- `SCORING_PROVIDER` must default to `"anthropic"` when unset, so existing setups (`ANTHROPIC_API_KEY` only) keep working unchanged.
- No fallback between providers on failure. A scoring failure (after retries are exhausted) stays fatal to the whole run — `scoreItems` throws, `digest.ts`'s `main().catch` logs and exits 1. Do not add cross-provider fallback or partial-digest logic.
- Don't assert third-party endpoint capabilities (e.g. `response_format: json_object` support) from memory — the plan notes where to verify this against a real endpoint before relying on it.
- Comments explain *why*, not *what* — don't add comments describing what a line obviously does.

---

## Task 1: Drop the `summary` field and switch to the `{"scores": [...]}` response contract

**Files:**
- Modify: `src/types.ts:32-37` (the `Score` interface)
- Modify: `src/score.ts:13-26` (`SYSTEM_PROMPT`), `src/score.ts:38-54` (`parseScores`), `src/score.ts:78` (fallback score object in `rankAndSort`)
- Modify: `src/render.ts:4-7` (`renderItem`)
- Modify: `src/score.test.ts:14-36` (parseScores tests), `src/score.test.ts:60-68` (`rankAndSort` test)
- Modify: `src/render.test.ts:6-14` (the `scored()` test helper)

**Interfaces:**
- Produces: `Score` — `{ relevance: number; category: Category }` (no `summary`). Consumed by every later task.
- Produces: `parseScores(raw: string, expected: number): Score[]` — now expects `raw` to parse to `{"scores": [...]}`, not a bare array. Consumed by Task 3's OpenAI-compatible path.

- [ ] **Step 1: Update the `Score` type**

Edit `src/types.ts`, replacing lines 32-37:

```ts
/** Claude's judgment for a single item. */
export interface Score {
  relevance: number; // 0–10
  summary: string; // one sentence
  category: Category;
}
```

with:

```ts
/** The scoring model's judgment for a single item. */
export interface Score {
  relevance: number; // 0–10
  category: Category;
}
```

- [ ] **Step 2: Update `score.test.ts` to expect the new schema — write the failing tests**

Edit `src/score.test.ts`, replacing lines 14-36:

```ts
test("parseScores accepts a clean JSON array", () => {
  const raw = '[{"relevance":7,"summary":"hi","category":"engineering"}]';
  const out = parseScores(raw, 1);
  assert.equal(out[0]?.relevance, 7);
  assert.equal(out[0]?.category, "engineering");
});

test("parseScores strips ```json fences before parsing", () => {
  const raw = '```json\n[{"relevance":3,"summary":"s","category":"ecosystem"}]\n```';
  assert.equal(parseScores(raw, 1).length, 1);
});

test("parseScores throws when the count does not match", () => {
  const raw = '[{"relevance":7,"summary":"hi","category":"engineering"}]';
  assert.throws(() => parseScores(raw, 2));
});

test("parseScores clamps relevance and falls back on bad category", () => {
  const raw = '[{"relevance":99,"summary":"s","category":"not-real"}]';
  const out = parseScores(raw, 1);
  assert.equal(out[0]?.relevance, 10);
  assert.equal(out[0]?.category, "ecosystem"); // safe fallback
});
```

with:

```ts
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
```

Also replace the `scores` literal in the `rankAndSort` test at lines 60-68:

```ts
test("rankAndSort sorts by blended rank descending", () => {
  const items = [item({ id: "a", tier: "awareness", weight: 1 }), item({ id: "b", tier: "tools", weight: 5 })];
  const scores = [
    { relevance: 8, summary: "a", category: "ecosystem" as const },
    { relevance: 8, summary: "b", category: "agents-tooling" as const },
  ];
  const out = rankAndSort(items, scores);
  assert.equal(out[0]?.id, "b"); // tools+weight5 outranks awareness+weight1 at equal relevance
});
```

with:

```ts
test("rankAndSort sorts by blended rank descending", () => {
  const items = [item({ id: "a", tier: "awareness", weight: 1 }), item({ id: "b", tier: "tools", weight: 5 })];
  const scores = [
    { relevance: 8, category: "ecosystem" as const },
    { relevance: 8, category: "agents-tooling" as const },
  ];
  const out = rankAndSort(items, scores);
  assert.equal(out[0]?.id, "b"); // tools+weight5 outranks awareness+weight1 at equal relevance
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `node --import tsx --test src/score.test.ts`
Expected: FAIL — `parseScores accepts a {scores:[...]} object` and related tests fail because `parseScores` still expects a bare array.

- [ ] **Step 4: Update `SYSTEM_PROMPT` and `parseScores` in `score.ts`**

Edit `src/score.ts`, replacing lines 13-26:

```ts
const SYSTEM_PROMPT = [
  "You score AI/agents news items for a senior software engineer who builds",
  "LLM-powered systems and agent tooling. Reward hands-on, buildable signal:",
  "model releases, agent frameworks/tooling, concrete techniques, and engineering",
  "writeups. Discount hype, funding-only news, and consumer fluff.",
  "",
  "For each input item return an object with:",
  '  - "relevance": integer 0–10 (10 = essential to a hands-on builder this week)',
  '  - "summary": one factual sentence, no marketing tone',
  `  - "category": one of ${CATEGORIES.join(", ")}`,
  "",
  "Respond with ONLY a JSON array, one object per input item, in the SAME ORDER.",
  "No prose, no markdown, no code fences.",
].join("\n");
```

with:

```ts
const SYSTEM_PROMPT = [
  "You score AI/agents news items for a senior software engineer who builds",
  "LLM-powered systems and agent tooling. Reward hands-on, buildable signal:",
  "model releases, agent frameworks/tooling, concrete techniques, and engineering",
  "writeups. Discount hype, funding-only news, and consumer fluff.",
  "",
  "For each input item return an object with:",
  '  - "relevance": integer 0–10 (10 = essential to a hands-on builder this week)',
  `  - "category": one of ${CATEGORIES.join(", ")}`,
  "",
  'Respond with ONLY a JSON object of the form {"scores": [...]}, one entry per',
  "input item, in the SAME ORDER. No prose, no markdown, no code fences.",
].join("\n");
```

Replace lines 38-54 (`parseScores`):

```ts
/** Defensively parse Claude's array; throws if the count != expected. */
export function parseScores(raw: string, expected: number): Score[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("scoring response was not a JSON array");
  if (parsed.length !== expected) {
    throw new Error(`scoring count mismatch: got ${parsed.length}, expected ${expected}`);
  }
  return parsed.map((entry): Score => {
    const obj = (entry ?? {}) as Record<string, unknown>;
    return {
      relevance: clampRelevance(obj.relevance),
      summary: typeof obj.summary === "string" ? obj.summary : "",
      category: safeCategory(obj.category),
    };
  });
}
```

with:

```ts
/** Defensively parse the model's {"scores": [...]} response; throws if the count != expected. */
export function parseScores(raw: string, expected: number): Score[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed: unknown = JSON.parse(cleaned);
  const scores = (parsed as { scores?: unknown } | null)?.scores;
  if (!Array.isArray(scores)) throw new Error("scoring response did not contain a scores array");
  if (scores.length !== expected) {
    throw new Error(`scoring count mismatch: got ${scores.length}, expected ${expected}`);
  }
  return scores.map((entry): Score => {
    const obj = (entry ?? {}) as Record<string, unknown>;
    return {
      relevance: clampRelevance(obj.relevance),
      category: safeCategory(obj.category),
    };
  });
}
```

Replace line 78 (the fallback score object inside `rankAndSort`):

```ts
    const s = scores[i] ?? { relevance: 0, summary: "", category: "ecosystem" as Category };
```

with:

```ts
    const s = scores[i] ?? { relevance: 0, category: "ecosystem" as Category };
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `node --import tsx --test src/score.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Update `render.ts` to drop the summary segment**

Edit `src/render.ts`, replacing lines 4-7:

```ts
function renderItem(item: ScoredItem): string {
  const footnote = `*${item.source} · relevance ${item.relevance}/10*`;
  return `- [${item.title}](${item.link}) — ${item.summary}\n  ${footnote}`;
}
```

with:

```ts
function renderItem(item: ScoredItem): string {
  const footnote = `*${item.source} · relevance ${item.relevance}/10*`;
  return `- [${item.title}](${item.link})\n  ${footnote}`;
}
```

- [ ] **Step 7: Update `render.test.ts`'s fixture helper**

Edit `src/render.test.ts`, replacing lines 6-14:

```ts
function scored(p: Partial<ScoredItem>): ScoredItem {
  return {
    id: p.id ?? "1", title: p.title ?? "Title", link: p.link ?? "https://x/1",
    source: p.source ?? "Src", tier: p.tier ?? "tools", weight: p.weight ?? 1,
    publishedAt: p.publishedAt ?? 0, relevance: p.relevance ?? 8,
    summary: p.summary ?? "A summary.", category: p.category ?? "engineering",
    rank: p.rank ?? 8,
  };
}
```

with:

```ts
function scored(p: Partial<ScoredItem>): ScoredItem {
  return {
    id: p.id ?? "1", title: p.title ?? "Title", link: p.link ?? "https://x/1",
    source: p.source ?? "Src", tier: p.tier ?? "tools", weight: p.weight ?? 1,
    publishedAt: p.publishedAt ?? 0, relevance: p.relevance ?? 8,
    category: p.category ?? "engineering",
    rank: p.rank ?? 8,
  };
}
```

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — all tests green, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/score.ts src/render.ts src/score.test.ts src/render.test.ts
git commit -m "refactor: drop summary field, switch scoring response to {scores:[...]}"
```

---

## Task 2: Shared retry wrapper for transient scoring failures

**Files:**
- Modify: `src/score.ts` (add near the top, after imports)
- Modify: `src/score.test.ts` (add new tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export class RetryableError extends Error {}`, `export function isRetryableStatus(status: number): boolean`, `export async function withRetry<T>(fn: () => Promise<T>, attempts?: number, baseDelayMs?: number): Promise<T>`. Consumed by Task 3's Anthropic and OpenAI-compatible batch callers.

- [ ] **Step 1: Write the failing tests**

Add to `src/score.test.ts` (new imports plus new tests at the end of the file):

Update the import line at the top of `src/score.test.ts`:

```ts
import { blendRank, capForBudget, parseScores, preScorePriority, rankAndSort } from "./score.js";
```

to:

```ts
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
```

Append at the end of `src/score.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `node --import tsx --test src/score.test.ts`
Expected: FAIL — `isRetryableStatus`, `withRetry`, `RetryableError` are not exported yet (import error / undefined).

- [ ] **Step 3: Implement `RetryableError`, `isRetryableStatus`, `withRetry` in `score.ts`**

Add to `src/score.ts`, immediately after the existing imports (before `const SYSTEM_PROMPT = ...`):

```ts
export class RetryableError extends Error {}

/** 429 (rate limited) and 5xx are worth retrying; everything else (4xx, parse errors) is not. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 1000,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof RetryableError) || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
    }
  }
  throw new Error("unreachable");
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `node --import tsx --test src/score.test.ts`
Expected: PASS — all tests green, including the four new ones.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/score.ts src/score.test.ts
git commit -m "feat: add withRetry wrapper for transient scoring failures"
```

---

## Task 3: OpenAI-compatible provider, config, and provider selection

**Files:**
- Modify: `src/config.ts` (add provider config, after line 16's `SCORE_BATCH_SIZE`)
- Modify: `src/score.ts` (rename/adapt `scoreBatch` → `scoreBatchAnthropic`, add `scoreBatchOpenAICompatible`, rewrite `scoreItems`)
- Modify: `src/score.test.ts` (add coverage for the OpenAI-compatible path)

**Interfaces:**
- Consumes: `RetryableError`, `isRetryableStatus`, `withRetry` from Task 2. `parseScores`, `Score`, `BatchResult` from Task 1 / existing `score.ts`.
- Produces: `SCORING_PROVIDER: "anthropic" | "openai-compatible"`, `LLM_ENDPOINT: string`, `LLM_API_KEY: string`, `LLM_MODEL: string` (all in `config.ts`). `scoreItems` behavior is otherwise unchanged from the outside (same signature, same return type) — this task only changes what happens inside it.

- [ ] **Step 1: Add provider config to `config.ts`**

Edit `src/config.ts`, inserting after line 16 (`export const SCORE_BATCH_SIZE = 25;`):

```ts

/**
 * Which scoring backend to use. "anthropic" (default) calls the Claude API;
 * "openai-compatible" POSTs to LLM_ENDPOINT using the OpenAI chat-completions
 * shape (works for Gemini's free tier, a self-hosted Ollama/vLLM server, etc.).
 */
export const SCORING_PROVIDER: "anthropic" | "openai-compatible" =
  process.env.SCORING_PROVIDER === "openai-compatible" ? "openai-compatible" : "anthropic";

/** Base URL for the openai-compatible provider, e.g. a Gemini or self-hosted endpoint. */
export const LLM_ENDPOINT = process.env.LLM_ENDPOINT ?? "";

/** Bearer token for the openai-compatible provider. Optional — some self-hosted servers need none. */
export const LLM_API_KEY = process.env.LLM_API_KEY ?? "";

/** Model name sent in the request body to the openai-compatible provider. */
export const LLM_MODEL = process.env.LLM_MODEL ?? "";
```

- [ ] **Step 2: Write the failing test for the OpenAI-compatible batch call**

Add to `src/score.test.ts`. First, add `scoreBatchOpenAICompatible` to the import from `./score.js` (update the import block from Task 2's Step 1 to include it):

```ts
import {
  blendRank,
  capForBudget,
  isRetryableStatus,
  parseScores,
  preScorePriority,
  rankAndSort,
  RetryableError,
  scoreBatchOpenAICompatible,
  withRetry,
} from "./score.js";
```

Append at the end of `src/score.test.ts`:

```ts
test("scoreBatchOpenAICompatible posts to {endpoint}/chat/completions and parses the response", async (t) => {
  const items = [item({ id: "a", title: "Title A" })];
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"scores":[{"relevance":6,"category":"engineering"}]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200 },
    );
  });

  const result = await scoreBatchOpenAICompatible(items, {
    endpoint: "https://x/v1",
    apiKey: "test-key",
    model: "test-model",
  });

  assert.equal(result.scores[0]?.relevance, 6);
  assert.equal(result.inputTokens, 10);
  assert.equal(result.outputTokens, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://x/v1/chat/completions");
  const body = JSON.parse(String(calls[0]?.init.body));
  assert.equal(body.model, "test-model");
  assert.equal(body.response_format.type, "json_object");
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer test-key");
});

test("scoreBatchOpenAICompatible omits the auth header when no apiKey is set", async (t) => {
  const items = [item({ id: "a" })];
  const calls: { init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls.push({ init });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"scores":[{"relevance":1,"category":"ecosystem"}]}' } }] }),
      { status: 200 },
    );
  });

  await scoreBatchOpenAICompatible(items, { endpoint: "https://x/v1", apiKey: "", model: "m" });

  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, undefined);
});

test("scoreBatchOpenAICompatible throws RetryableError on a 429 response", async (t) => {
  const items = [item({ id: "a" })];
  t.mock.method(globalThis, "fetch", async () => new Response("rate limited", { status: 429 }));

  await assert.rejects(
    scoreBatchOpenAICompatible(items, { endpoint: "https://x/v1", apiKey: "", model: "m" }),
    RetryableError,
  );
});

test("scoreBatchOpenAICompatible throws a plain Error on a 400 response", async (t) => {
  const items = [item({ id: "a" })];
  t.mock.method(globalThis, "fetch", async () => new Response("bad request", { status: 400 }));

  await assert.rejects(
    scoreBatchOpenAICompatible(items, { endpoint: "https://x/v1", apiKey: "", model: "m" }),
    (err: unknown) => err instanceof Error && !(err instanceof RetryableError),
  );
});

test("scoreBatchOpenAICompatible defaults token counts to 0 when usage is missing", async (t) => {
  const items = [item({ id: "a" })];
  t.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '{"scores":[{"relevance":1,"category":"ecosystem"}]}' } }] }),
    { status: 200 },
  ));

  const result = await scoreBatchOpenAICompatible(items, { endpoint: "https://x/v1", apiKey: "", model: "m" });
  assert.equal(result.inputTokens, 0);
  assert.equal(result.outputTokens, 0);
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `node --import tsx --test src/score.test.ts`
Expected: FAIL — `scoreBatchOpenAICompatible` is not exported yet.

- [ ] **Step 4: Implement the provider split in `score.ts`**

First, add the `Anthropic` import stays; add nothing new to imports (fetch and `Response` are Node globals).

Rename the existing `scoreBatch` function to `scoreBatchAnthropic` and wrap its failure path so rate-limit/server errors become `RetryableError`. Replace the current (lines ~95-111, post-Task-1/2 renumbering — locate by function name, not line number, since Tasks 1-2 shifted lines):

```ts
async function scoreBatch(client: Anthropic, batch: FeedItem[]): Promise<BatchResult> {
  const response = await client.messages.create({
    model: SCORING_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(batch) }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    scores: parseScores(text, batch.length),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
```

with:

```ts
/** True if `err` carries an HTTP-style `status` that's worth retrying. Duck-typed since the SDK's error shape isn't a hard contract to depend on. */
function isRetryableAnthropicError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && isRetryableStatus(status);
}

async function scoreBatchAnthropic(client: Anthropic, batch: FeedItem[]): Promise<BatchResult> {
  let response;
  try {
    response = await client.messages.create({
      model: SCORING_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(batch) }],
    });
  } catch (err) {
    if (isRetryableAnthropicError(err)) throw new RetryableError(String(err));
    throw err;
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    scores: parseScores(text, batch.length),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

interface OpenAICompatibleOpts {
  endpoint: string;
  apiKey: string;
  model: string;
}

export async function scoreBatchOpenAICompatible(
  batch: FeedItem[],
  opts: OpenAICompatibleOpts,
): Promise<BatchResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

  const response = await fetch(`${opts.endpoint}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(batch) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const message = `openai-compatible scoring request failed: ${response.status} ${response.statusText}`;
    if (isRetryableStatus(response.status)) throw new RetryableError(message);
    throw new Error(message);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    scores: parseScores(text, batch.length),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}
```

Update the import at the top of `src/score.ts` to pull in the new config values. Replace:

```ts
import {
  CATEGORIES,
  MAX_ITEMS_PER_RUN,
  PRICE_PER_INPUT_TOKEN,
  PRICE_PER_OUTPUT_TOKEN,
  SCORE_BATCH_SIZE,
  SCORING_MODEL,
  TIER_PRIORITY,
} from "./config.js";
```

with:

```ts
import {
  CATEGORIES,
  LLM_API_KEY,
  LLM_ENDPOINT,
  LLM_MODEL,
  MAX_ITEMS_PER_RUN,
  PRICE_PER_INPUT_TOKEN,
  PRICE_PER_OUTPUT_TOKEN,
  SCORE_BATCH_SIZE,
  SCORING_MODEL,
  SCORING_PROVIDER,
  TIER_PRIORITY,
} from "./config.js";
```

Finally, replace `scoreItems` (the function that currently instantiates `new Anthropic()` unconditionally and calls `scoreBatch`):

```ts
/** Score every item (capped + batched), return ranked descending. Requires ANTHROPIC_API_KEY. */
export async function scoreItems(items: FeedItem[]): Promise<ScoredItem[]> {
  const capped = capForBudget(items);
  if (capped.length === 0) return [];
  const client = new Anthropic();
  const batches = chunk(capped, SCORE_BATCH_SIZE);

  let inputTokens = 0;
  let outputTokens = 0;
  const scoredBatches = await Promise.all(
    batches.map(async (batch) => {
      const result = await scoreBatch(client, batch);
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      return rankAndSort(batch, result.scores);
    }),
  );

  const cost = inputTokens * PRICE_PER_INPUT_TOKEN + outputTokens * PRICE_PER_OUTPUT_TOKEN;
  console.log(`[score] ${capped.length} items · ${inputTokens} in / ${outputTokens} out tokens · ~$${cost.toFixed(4)}`);

  return scoredBatches.flat().sort((a, b) => b.rank - a.rank);
}
```

with:

```ts
/** Score every item (capped + batched), return ranked descending. Provider chosen by SCORING_PROVIDER. */
export async function scoreItems(items: FeedItem[]): Promise<ScoredItem[]> {
  const capped = capForBudget(items);
  if (capped.length === 0) return [];
  const batches = chunk(capped, SCORE_BATCH_SIZE);

  const callBatch: (batch: FeedItem[]) => Promise<BatchResult> =
    SCORING_PROVIDER === "openai-compatible"
      ? (batch) =>
          withRetry(() =>
            scoreBatchOpenAICompatible(batch, { endpoint: LLM_ENDPOINT, apiKey: LLM_API_KEY, model: LLM_MODEL }),
          )
      : (() => {
          const client = new Anthropic();
          return (batch) => withRetry(() => scoreBatchAnthropic(client, batch));
        })();

  let inputTokens = 0;
  let outputTokens = 0;
  const scoredBatches = await Promise.all(
    batches.map(async (batch) => {
      const result = await callBatch(batch);
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      return rankAndSort(batch, result.scores);
    }),
  );

  if (SCORING_PROVIDER === "anthropic") {
    const cost = inputTokens * PRICE_PER_INPUT_TOKEN + outputTokens * PRICE_PER_OUTPUT_TOKEN;
    console.log(`[score] ${capped.length} items · ${inputTokens} in / ${outputTokens} out tokens · ~$${cost.toFixed(4)}`);
  } else {
    console.log(`[score] ${capped.length} items · ${inputTokens} in / ${outputTokens} out tokens (provider=openai-compatible)`);
  }

  return scoredBatches.flat().sort((a, b) => b.rank - a.rank);
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `node --import tsx --test src/score.test.ts`
Expected: PASS — all tests green, including the five new `scoreBatchOpenAICompatible` tests.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Manually verify against your real Gemini/self-hosted endpoint**

This step can't be automated in this plan — do it once by hand before relying on the feature:

```bash
SCORING_PROVIDER=openai-compatible \
LLM_ENDPOINT="https://generativelanguage.googleapis.com/v1beta/openai" \
LLM_API_KEY="<your Gemini API key>" \
LLM_MODEL="<your chosen Gemini model>" \
npm run digest
```

Confirm in the output: the `[score]` log line appears with `provider=openai-compatible`, and the digest file under `digests/` contains items with sensible `relevance`/`category` values (not all falling back to `ecosystem`/0, which would indicate the endpoint isn't returning parseable JSON — per the Global Constraints, don't assume `response_format: json_object` works until you see this pass).

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/score.ts src/score.test.ts
git commit -m "feat: add openai-compatible scoring provider, selectable via SCORING_PROVIDER"
```

---

## Task 4: Documentation and CI workflow

**Files:**
- Modify: `README.md` (env var table, architecture line, add a short section on the openai-compatible provider)
- Modify: `.github/workflows/digest.yml:26-30` (env block)
- Modify: `CLAUDE.md` (the "Scoring uses `claude-haiku-4-5`" convention note)

**Interfaces:**
- Consumes: `SCORING_PROVIDER`, `LLM_ENDPOINT`, `LLM_API_KEY`, `LLM_MODEL` from Task 3 (documents them; no code).

- [ ] **Step 1: Update `README.md`'s environment variable table**

Edit `README.md`, replacing the table at lines 39-44:

```markdown
| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes (for scoring) | Authenticates the Claude scoring call. |
| `GMAIL_USER` | No | Gmail address used to send the digest. |
| `GMAIL_APP_PASSWORD` | No | Gmail **app password** (account must have 2FA enabled). |
| `DIGEST_TO` | No | Recipient; defaults to `GMAIL_USER`. |
```

with:

```markdown
| Variable | Required | Purpose |
|---|---|---|
| `SCORING_PROVIDER` | No | `anthropic` (default) or `openai-compatible`. See below. |
| `ANTHROPIC_API_KEY` | Yes, if `SCORING_PROVIDER=anthropic` | Authenticates the Claude scoring call. |
| `LLM_ENDPOINT` | Yes, if `SCORING_PROVIDER=openai-compatible` | Base URL of an OpenAI-compatible chat-completions endpoint (e.g. Gemini's free-tier API, or a self-hosted server). |
| `LLM_API_KEY` | No | Bearer token for `LLM_ENDPOINT`. Omit if your endpoint doesn't require auth. |
| `LLM_MODEL` | Yes, if `SCORING_PROVIDER=openai-compatible` | Model name sent in the request body. |
| `GMAIL_USER` | No | Gmail address used to send the digest. |
| `GMAIL_APP_PASSWORD` | No | Gmail **app password** (account must have 2FA enabled). |
| `DIGEST_TO` | No | Recipient; defaults to `GMAIL_USER`. |
```

Add a new section right after the environment variable table (after the line `If the Gmail vars are unset, email is skipped and logged — local runs work without them.`):

```markdown

## Using an OpenAI-compatible scoring provider

Set `SCORING_PROVIDER=openai-compatible` to score with anything that exposes an
OpenAI-style `/chat/completions` endpoint instead of Claude — for example
Gemini's free tier:

```bash
SCORING_PROVIDER=openai-compatible
LLM_ENDPOINT=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=<your Gemini API key>
LLM_MODEL=<your chosen Gemini model>
```

or a self-hosted server (Ollama, vLLM, etc.) reachable over the network:

```bash
SCORING_PROVIDER=openai-compatible
LLM_ENDPOINT=https://your-host/v1
LLM_MODEL=<model name your server serves>
# LLM_API_KEY only if your server requires one
```

Verify the endpoint actually returns parseable JSON before relying on it —
not every OpenAI-compatible server honors `response_format: json_object` the
same way. Run `npm run digest` once with the vars above and check the
`[score]` log line and the resulting digest file.
```

- [ ] **Step 2: Update the "How it works" line and cost section header in `README.md`**

Replace line 5 (`item with Claude for builder-relevance, renders a topic-grouped markdown digest, emails`) — this line reads in context (lines 4-7):

```markdown
It pulls tiered RSS/Atom feeds, removes items seen in past runs, scores each remaining
item with Claude for builder-relevance, renders a topic-grouped markdown digest, emails
it (best-effort), and commits the digest plus dedup state. Every digest is committed, so
the repo doubles as a searchable archive — no database, no server.
```

with:

```markdown
It pulls tiered RSS/Atom feeds, removes items seen in past runs, scores each remaining
item with an LLM for builder-relevance (Claude by default, or any OpenAI-compatible
endpoint), renders a topic-grouped markdown digest, emails it (best-effort), and commits
the digest plus dedup state. Every digest is committed, so the repo doubles as a
searchable archive — no database, no server.
```

And line 12 (the pipeline diagram):

```markdown
sources → fetch → dedupe (seen-store) → score (Claude) → render → write digest → save state → email
```

with:

```markdown
sources → fetch → dedupe (seen-store) → score (LLM) → render → write digest → save state → email
```

- [ ] **Step 3: Update the "Cost & billing cap" section in `README.md`**

Replace the opening sentence of that section (line 50-53):

```markdown
Scoring runs on the **Anthropic API** (`@anthropic-ai/sdk`), which is billed pay-as-you-go
from API credits at `console.anthropic.com` — **separate from a Claude Pro/Max subscription**,
which it does not touch. Using `claude-haiku-4-5`, a weekly run costs a few cents; expect
well under **$1/month**. Each run logs its actual token usage and estimated cost (`[score] … ~$0.0xxx`).
```

with:

```markdown
This section applies when `SCORING_PROVIDER=anthropic` (the default). Scoring runs on the
**Anthropic API** (`@anthropic-ai/sdk`), which is billed pay-as-you-go from API credits at
`console.anthropic.com` — **separate from a Claude Pro/Max subscription**, which it does not
touch. Using `claude-haiku-4-5`, a weekly run costs a few cents; expect well under **$1/month**.
Each run logs its actual token usage and estimated cost (`[score] … ~$0.0xxx`).

With `SCORING_PROVIDER=openai-compatible`, cost depends entirely on your endpoint (e.g. free
under Gemini's free tier, or $0 for a self-hosted server) — the run logs token counts without
a cost estimate, since pricing for an arbitrary endpoint isn't known.
```

- [ ] **Step 4: Update `.github/workflows/digest.yml`**

Edit `.github/workflows/digest.yml`, replacing the `env:` block at lines 26-30:

```yaml
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          DIGEST_TO: ${{ secrets.DIGEST_TO }}
```

with:

```yaml
        env:
          SCORING_PROVIDER: ${{ secrets.SCORING_PROVIDER }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LLM_ENDPOINT: ${{ secrets.LLM_ENDPOINT }}
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
          LLM_MODEL: ${{ secrets.LLM_MODEL }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          DIGEST_TO: ${{ secrets.DIGEST_TO }}
```

An unset repo secret resolves to an empty string, which is exactly `config.ts`'s existing
fallback (`process.env.X ?? ""`) — so this is safe to add even before any of the new secrets
are configured; the workflow keeps using the Anthropic path until `SCORING_PROVIDER` is set.

- [ ] **Step 5: Update the "Automation" section in `README.md`**

Replace line 88-91:

```markdown
`.github/workflows/digest.yml` runs weekly (Mondays 13:00 UTC) and on manual dispatch,
then commits new digests and dedup state. Add `ANTHROPIC_API_KEY`, `GMAIL_USER`,
`GMAIL_APP_PASSWORD`, and `DIGEST_TO` as repository secrets. The cron cadence and the
`LOOKBACK_DAYS` window in `src/config.ts` are kept in agreement (weekly + 8-day window).
```

with:

```markdown
`.github/workflows/digest.yml` runs weekly (Mondays 13:00 UTC) and on manual dispatch,
then commits new digests and dedup state. Add `ANTHROPIC_API_KEY` (or `SCORING_PROVIDER`,
`LLM_ENDPOINT`, `LLM_API_KEY`, `LLM_MODEL` for the openai-compatible path), `GMAIL_USER`,
`GMAIL_APP_PASSWORD`, and `DIGEST_TO` as repository secrets. The cron cadence and the
`LOOKBACK_DAYS` window in `src/config.ts` are kept in agreement (weekly + 8-day window).
```

- [ ] **Step 6: Update `CLAUDE.md`'s scoring convention note**

Edit `CLAUDE.md`, replacing the line:

```markdown
- Scoring uses `claude-haiku-4-5` (cheap/fast batch classification). Update the id in `config.ts` if migrating models.
```

with:

```markdown
- Scoring provider is configurable via `SCORING_PROVIDER` in `config.ts`/env: `anthropic` (default, `claude-haiku-4-5`) or `openai-compatible` (any OpenAI-style `/chat/completions` endpoint — Gemini free tier, self-hosted, etc.). Update `SCORING_MODEL` or `LLM_MODEL` in `config.ts` if migrating models.
```

- [ ] **Step 7: Run the full test suite and typecheck one more time**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add README.md CLAUDE.md .github/workflows/digest.yml
git commit -m "docs: document the openai-compatible scoring provider"
```