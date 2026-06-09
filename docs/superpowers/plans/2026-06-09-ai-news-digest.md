# AI/Agents Weekly News Digest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a weekly, unattended AI/agents news aggregator that fetches tiered RSS/Atom feeds, dedupes against past runs, scores each item with Claude for relevance to a hands-on LLM/agent builder, renders a topic-grouped markdown digest, emails it best-effort, and commits the digest + dedup state — runnable locally and via GitHub Actions.

**Architecture:** A handful of small single-purpose ESM/TypeScript modules under `src/`, run directly with `tsx` (no build step). Data flows one direction through discrete stages: `sources → fetch → seen-store dedupe → score (Claude) → render → write digest → save seen-store → email`. Persistence is two flat artifacts: a committed `digests/YYYY-MM-DD.md` per run and a committed `state/seen.json` dedup file. No database, no server, no frontend. Email is layered on top and never in the critical path — the digest is always written and the seen-store always saved before email is attempted, and email failures are swallowed.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), ESM, Node 22 (local dev is Node 20 — both run `tsx` fine), `tsx` runner, `@anthropic-ai/sdk` (model `claude-haiku-4-5` for batch scoring), `rss-parser` for feeds, `nodemailer` for Gmail SMTP. Tests use Node's built-in `node:test` runner (zero extra deps).

---

## Conventions for every task

- **ESM import specifiers for local files end in `.js`** even though the source is `.ts` (Node ESM resolution requirement). Example: `import { fetchAll } from "./fetch.js";`.
- **Comments explain why, not what.** Keep them sparse.
- **`noUncheckedIndexedAccess` is on:** any `arr[i]` is `T | undefined`. Guard or assert before use.
- After each task's code steps, the typecheck step must pass clean (`npm run typecheck`).
- Commit at the end of every task.

---

## File structure (build in this order)

| File | Responsibility |
|---|---|
| `package.json` | Scripts (`digest`, `discovery`, `typecheck`, `test`), deps, `"type": "module"` |
| `tsconfig.json` | Strict TS config, `noEmit`, `noUncheckedIndexedAccess` |
| `.gitignore` | `node_modules`, `.env`, editor cruft |
| `src/types.ts` | Shared types: `Tier`, `Source`, `FeedItem`, `Category`, `Score`, `ScoredItem` |
| `src/config.ts` | Tunables: lookback window, prune age, threshold, model id, batch size, tier priority, categories |
| `src/sources.ts` | Declarative feed list + `githubReleases()` helper |
| `src/fetch.ts` | Parallel fetch, normalize, lookback filter, in-batch dedup by content hash |
| `src/seen-store.ts` | Load/save/prune the flat JSON dedup file; filter new items |
| `src/score.ts` | Batch items to Claude, defensive JSON parse, ranking blend, sort |
| `src/render.ts` | Group kept items by category into markdown |
| `src/email.ts` | Markdown→inline-HTML, Gmail SMTP send (best-effort) |
| `src/digest.ts` | Orchestrator entry point |
| `src/discovery.ts` | Independent "awesome-list" new-source discovery script |
| `.github/workflows/digest.yml` | Weekly cron + manual dispatch, commits digests + state |
| `README.md` | Setup, env vars, how to add a source |
| `CLAUDE.md` | Rewritten from spec to concise real-architecture guidance (final task) |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git and create `package.json`**

The repo is not yet a git repository. Initialize it and create the manifest.

Run:
```bash
cd /Users/eyalpolitansky/ai-news && git init && git branch -m main
```

Create `package.json`:
```json
{
  "name": "ai-news",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Weekly AI/agents news digest aggregator",
  "scripts": {
    "digest": "tsx src/digest.ts",
    "discovery": "tsx src/discovery.ts",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test \"src/**/*.test.ts\""
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.69.0",
    "nodemailer": "^7.0.0",
    "rss-parser": "^3.13.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/nodemailer": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.env
*.log
.DS_Store
```

- [ ] **Step 4: Install dependencies**

Run:
```bash
cd /Users/eyalpolitansky/ai-news && npm install
```
Expected: `node_modules/` created, lockfile written, no error exit. If the exact dependency versions above 404, install latest with `npm install @anthropic-ai/sdk nodemailer rss-parser` and `npm install -D @types/node @types/nodemailer tsx typescript`, then accept whatever versions resolve.

- [ ] **Step 5: Verify typecheck runs on an empty source tree**

Run:
```bash
cd /Users/eyalpolitansky/ai-news && mkdir -p src && npm run typecheck
```
Expected: exits 0 (no `.ts` files yet, or "No inputs were found" — if that errors, it's fine to ignore until Task 2 adds files; do not treat an empty-input error as a failure of this step).

- [ ] **Step 6: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add package.json package-lock.json tsconfig.json .gitignore && git commit -m "chore: scaffold TypeScript ESM project"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
export type Tier = "tools" | "learning" | "awareness";

export interface Source {
  name: string;
  url: string;
  tier: Tier;
  /** Relative importance within/across tiers, scale 1–5. */
  weight: number;
}

/** A feed entry normalized to a common shape. */
export interface FeedItem {
  /** Content hash of link + title — stable dedup key across runs. */
  id: string;
  title: string;
  link: string;
  /** Source name this item came from. */
  source: string;
  tier: Tier;
  weight: number;
  /** Publication time, epoch milliseconds. */
  publishedAt: number;
}

export type Category =
  | "model-release"
  | "agents-tooling"
  | "technique-research"
  | "engineering"
  | "ecosystem";

/** Claude's judgment for a single item. */
export interface Score {
  relevance: number; // 0–10
  summary: string; // one sentence
  category: Category;
}

/** A feed item enriched with its score and final blended rank. */
export interface ScoredItem extends FeedItem, Score {
  rank: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS (exit 0).

- [ ] **Step 3: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/types.ts && git commit -m "feat: shared types for the digest pipeline"
```

---

## Task 3: Config (tunables)

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Write `src/config.ts`**

These are the knobs the user adjusts. `LOOKBACK_DAYS` (8) is intentionally one day longer than the 7-day cron cadence so nothing slips between runs — the two must agree (see the workflow task).

```typescript
import type { Category, Tier } from "./types.js";

/** Fetch window in days — slightly longer than the weekly cron so nothing is missed. */
export const LOOKBACK_DAYS = 8;

/** Drop seen-store entries older than this many days to keep the file small. */
export const SEEN_PRUNE_DAYS = 90;

/** Keep only items scoring at or above this relevance (0–10). */
export const RELEVANCE_THRESHOLD = 5;

/** Claude model for batch relevance scoring — cheap, fast, supports structured output. */
export const SCORING_MODEL = "claude-haiku-4-5";

/** Items per Claude scoring request. */
export const SCORE_BATCH_SIZE = 25;

/**
 * Hard ceiling on items scored per run — bounds worst-case API cost in code.
 * Lowest pre-score-priority items (low tier + low weight) are dropped first.
 * At 150 items a run costs well under $0.05; combined with the Console monthly
 * spend cap (see README), cost stays comfortably under $1/month.
 */
export const MAX_ITEMS_PER_RUN = 150;

/** claude-haiku-4-5 pricing (USD per token), for the per-run cost estimate log. */
export const PRICE_PER_INPUT_TOKEN = 1 / 1_000_000;
export const PRICE_PER_OUTPUT_TOKEN = 5 / 1_000_000;

/** Priority added to the blended rank by tier (tools > learning > awareness). */
export const TIER_PRIORITY: Record<Tier, number> = {
  tools: 2,
  learning: 1,
  awareness: 0,
};

/** Fixed category set, in render order, with display headings. */
export const CATEGORY_TITLES: Record<Category, string> = {
  "model-release": "Model Releases",
  "agents-tooling": "Agents & Tooling",
  "technique-research": "Techniques & Research",
  engineering: "Engineering",
  ecosystem: "Ecosystem",
};

/** The valid categories, derived from CATEGORY_TITLES so they never drift apart. */
export const CATEGORIES = Object.keys(CATEGORY_TITLES) as Category[];
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/config.ts && git commit -m "feat: tunable config for windows, threshold, model, ranking"
```

---

## Task 4: Sources file + GitHub releases helper

**Files:**
- Create: `src/sources.ts`
- Test: `src/sources.test.ts`

- [ ] **Step 1: Write the failing test for the GitHub releases helper**

Create `src/sources.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { githubReleases, SOURCES } from "./sources.js";

test("githubReleases builds the .releases.atom URL", () => {
  assert.equal(
    githubReleases("langchain-ai", "langgraph"),
    "https://github.com/langchain-ai/langgraph/releases.atom",
  );
});

test("every source has a name, url, valid tier, and numeric weight", () => {
  const tiers = new Set(["tools", "learning", "awareness"]);
  assert.ok(SOURCES.length > 0);
  for (const s of SOURCES) {
    assert.ok(s.name.length > 0, `name missing on ${s.url}`);
    assert.match(s.url, /^https?:\/\//, `bad url on ${s.name}`);
    assert.ok(tiers.has(s.tier), `bad tier on ${s.name}`);
    assert.equal(typeof s.weight, "number", `bad weight on ${s.name}`);
  }
});

test("source names are unique", () => {
  const names = SOURCES.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: FAIL — cannot resolve `./sources.js` (module does not exist yet).

- [ ] **Step 3: Write `src/sources.ts`**

This is the file the user edits most. Keep the tiers clearly commented. The URLs here are *candidates* — Task 5 verifies each actually parses and prunes any that don't.

```typescript
import type { Source } from "./types.js";

/** GitHub publishes a per-repo Atom feed of releases at this path. */
export function githubReleases(org: string, repo: string): string {
  return `https://github.com/${org}/${repo}/releases.atom`;
}

/**
 * Tiered feed list. Priority order: tools > learning > awareness.
 *
 * - tools     — release feeds & framework/tooling news a builder acts on directly.
 * - learning  — newsletters, technique writeups, lab/engineering blogs.
 * - awareness — broad signal (filtered HN, arXiv) to skim, lower priority.
 *
 * `weight` (1–5) is relative importance used in the final rank blend.
 * Add a source by appending an object here; run `npm run discovery` to find candidates.
 */
export const SOURCES: Source[] = [
  // ── tools ──────────────────────────────────────────────────────────────
  { name: "LangGraph releases", url: githubReleases("langchain-ai", "langgraph"), tier: "tools", weight: 5 },
  { name: "LangChain releases", url: githubReleases("langchain-ai", "langchain"), tier: "tools", weight: 4 },
  { name: "LlamaIndex releases", url: githubReleases("run-llama", "llama_index"), tier: "tools", weight: 4 },
  { name: "Anthropic SDK (Python) releases", url: githubReleases("anthropics", "anthropic-sdk-python"), tier: "tools", weight: 4 },
  { name: "OpenAI SDK (Python) releases", url: githubReleases("openai", "openai-python"), tier: "tools", weight: 3 },
  { name: "Vercel AI SDK releases", url: githubReleases("vercel", "ai"), tier: "tools", weight: 4 },
  { name: "LiteLLM releases", url: githubReleases("BerriAI", "litellm"), tier: "tools", weight: 3 },
  { name: "MCP servers releases", url: githubReleases("modelcontextprotocol", "servers"), tier: "tools", weight: 4 },
  { name: "CrewAI releases", url: githubReleases("crewAIInc", "crewAI"), tier: "tools", weight: 3 },
  { name: "Pydantic AI releases", url: githubReleases("pydantic", "pydantic-ai"), tier: "tools", weight: 4 },

  // ── learning ───────────────────────────────────────────────────────────
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", tier: "learning", weight: 5 },
  { name: "Latent Space", url: "https://www.latent.space/feed", tier: "learning", weight: 4 },
  { name: "Lilian Weng", url: "https://lilianweng.github.io/index.xml", tier: "learning", weight: 4 },
  { name: "Hugging Face blog", url: "https://huggingface.co/blog/feed.xml", tier: "learning", weight: 3 },
  { name: "Anthropic engineering", url: "https://www.anthropic.com/engineering/rss.xml", tier: "learning", weight: 4 },
  { name: "Google Research blog", url: "https://research.google/blog/rss/", tier: "learning", weight: 3 },

  // ── awareness ──────────────────────────────────────────────────────────
  { name: "Hacker News (front page ≥150pts)", url: "https://hnrss.org/frontpage?points=150", tier: "awareness", weight: 2 },
  { name: "HN: LLM/agents (≥80pts)", url: "https://hnrss.org/newest?q=LLM+OR+agents+OR+Claude+OR+GPT&points=80", tier: "awareness", weight: 2 },
  { name: "arXiv cs.AI agents", url: "http://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+all:agent&start=0&max_results=40&sortBy=submittedDate&sortOrder=descending", tier: "awareness", weight: 1 },
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/sources.ts src/sources.test.ts && git commit -m "feat: seeded tiered sources + githubReleases helper"
```

---

## Task 5: Verify every seeded feed actually parses (and prune dead ones)

**Files:**
- Temporary: `scripts/verify-feeds.ts` (throwaway; delete after)
- Modify: `src/sources.ts` (only if a URL fails)

This task is a **one-time verification gate**, not shipped code. The spec forbids asserting a feed URL works from memory — so we parse every seeded feed for real and remove or fix any that fail.

- [ ] **Step 1: Write the throwaway verifier**

Create `scripts/verify-feeds.ts`:
```typescript
import Parser from "rss-parser";
import { SOURCES } from "../src/sources.js";

const parser = new Parser({ timeout: 20000 });

const results = await Promise.allSettled(
  SOURCES.map(async (s) => {
    const feed = await parser.parseURL(s.url);
    return { name: s.name, count: feed.items?.length ?? 0 };
  }),
);

let failures = 0;
results.forEach((r, i) => {
  const s = SOURCES[i];
  if (!s) return;
  if (r.status === "fulfilled") {
    console.log(`OK   ${s.name} — ${r.value.count} items`);
  } else {
    failures++;
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    console.log(`FAIL ${s.name} (${s.url}) — ${reason}`);
  }
});
console.log(`\n${failures} failing of ${SOURCES.length}`);
```

- [ ] **Step 2: Run the verifier**

Run:
```bash
cd /Users/eyalpolitansky/ai-news && npx tsx scripts/verify-feeds.ts
```
Expected: a line per source. Most should print `OK ... — N items`.

- [ ] **Step 3: Fix or remove failing feeds**

For each `FAIL` line:
- If it's a transient network/timeout, re-run once to confirm it's really dead.
- If a known feed moved, replace the URL with a working one (e.g., try `https://<host>/feed`, `/rss`, `/atom.xml`, `/index.xml`, or the site's documented feed URL). For Hugging Face, `https://huggingface.co/blog/feed.xml` is the documented path; for arXiv, the `export.arxiv.org/api/query` Atom endpoint is correct.
- If no working feed exists, delete that `Source` from `SOURCES`.

Do **not** stop until the verifier reports `0 failing`. Re-run Step 2 after each edit.

- [ ] **Step 4: Re-run the sources tests (uniqueness/shape still hold after edits)**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: PASS.

- [ ] **Step 5: Delete the throwaway verifier**

Run:
```bash
cd /Users/eyalpolitansky/ai-news && rm -rf scripts
```

- [ ] **Step 6: Commit (only if sources changed)**

```bash
cd /Users/eyalpolitansky/ai-news && git add -A && git commit -m "fix: prune/repair seeded feeds verified to parse" || echo "no source changes needed"
```

---

## Task 6: Fetch stage

**Files:**
- Create: `src/fetch.ts`
- Test: `src/fetch.test.ts`

The fetch stage: pull all feeds in parallel, normalize each entry, drop anything older than the lookback window, and dedupe within the batch by a content hash of link+title (on collision keep the higher-weight source). A single feed failing must log and continue, never abort.

- [ ] **Step 1: Write the failing test (pure helpers: hashing, dedup, normalize)**

`fetch.ts` exposes pure helpers so the network-free logic is unit-tested. Create `src/fetch.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: FAIL — cannot resolve `./fetch.js`.

- [ ] **Step 3: Write `src/fetch.ts`**

```typescript
import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { LOOKBACK_DAYS } from "./config.js";
import { SOURCES } from "./sources.js";
import type { FeedItem, Source } from "./types.js";

const parser = new Parser({ timeout: 20000 });

/** Stable dedup key from a feed entry's link and title. */
export function contentHash(link: string, title: string): string {
  return createHash("sha256").update(`${link}\n${title}`).digest("hex").slice(0, 16);
}

/** Collapse same-hash items, keeping the higher-weight source on collision. */
export function dedupeByHash(items: FeedItem[]): FeedItem[] {
  const byHash = new Map<string, FeedItem>();
  for (const item of items) {
    const existing = byHash.get(item.id);
    if (!existing || item.weight > existing.weight) {
      byHash.set(item.id, item);
    }
  }
  return [...byHash.values()];
}

function normalize(source: Source, entry: Parser.Item): FeedItem | null {
  const link = entry.link?.trim();
  const title = entry.title?.trim();
  if (!link || !title) return null;

  const dateStr = entry.isoDate ?? entry.pubDate;
  const publishedAt = dateStr ? Date.parse(dateStr) : NaN;
  // Items without a usable date can't be windowed; treat as "now" so they're not lost.
  const ts = Number.isNaN(publishedAt) ? Date.now() : publishedAt;

  return {
    id: contentHash(link, title),
    title,
    link,
    source: source.name,
    tier: source.tier,
    weight: source.weight,
    publishedAt: ts,
  };
}

async function fetchOne(source: Source, cutoff: number): Promise<FeedItem[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const items: FeedItem[] = [];
    for (const entry of feed.items ?? []) {
      const item = normalize(source, entry);
      if (item && item.publishedAt >= cutoff) items.push(item);
    }
    return items;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[fetch] skipping "${source.name}": ${reason}`);
    return [];
  }
}

/** Pull all feeds in parallel, window to the lookback period, dedupe the batch. */
export async function fetchAll(now = Date.now()): Promise<FeedItem[]> {
  const cutoff = now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const batches = await Promise.all(SOURCES.map((s) => fetchOne(s, cutoff)));
  return dedupeByHash(batches.flat());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: PASS (sources tests + fetch tests).

- [ ] **Step 5: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/fetch.ts src/fetch.test.ts && git commit -m "feat: parallel fetch with lookback windowing and batch dedup"
```

---

## Task 7: Seen-store (idempotency)

**Files:**
- Create: `src/seen-store.ts`
- Test: `src/seen-store.test.ts`

A flat JSON file mapping item id → first-seen epoch ms. `filterNew` drops items already recorded; `prune` removes entries older than `SEEN_PRUNE_DAYS`. This is what makes weekly runs idempotent.

- [ ] **Step 1: Write the failing test**

Create `src/seen-store.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: FAIL — cannot resolve `./seen-store.js`.

- [ ] **Step 3: Write `src/seen-store.ts`**

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SEEN_PRUNE_DAYS } from "./config.js";
import type { FeedItem } from "./types.js";

export type { FeedItem } from "./types.js";

/** item id → first-seen epoch ms. */
export type SeenStore = Record<string, number>;

export const SEEN_PATH = "state/seen.json";

export async function loadSeen(path = SEEN_PATH): Promise<SeenStore> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SeenStore) : {};
  } catch {
    return {}; // first run, or unreadable — start clean
  }
}

export async function saveSeen(store: SeenStore, path = SEEN_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/** Items whose id is not yet in the store. */
export function filterNew(items: FeedItem[], store: SeenStore): FeedItem[] {
  return items.filter((i) => !(i.id in store));
}

/** Record ids at `now`, without overwriting an earlier first-seen timestamp. */
export function recordSeen(items: FeedItem[], store: SeenStore, now = Date.now()): void {
  for (const i of items) {
    if (!(i.id in store)) store[i.id] = now;
  }
}

/** Return a copy with entries older than SEEN_PRUNE_DAYS removed. */
export function prune(store: SeenStore, now = Date.now()): SeenStore {
  const cutoff = now - SEEN_PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const out: SeenStore = {};
  for (const [id, ts] of Object.entries(store)) {
    if (ts >= cutoff) out[id] = ts;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/seen-store.ts src/seen-store.test.ts && git commit -m "feat: flat-file seen-store for cross-run idempotency"
```

---

## Task 8: Score stage (Claude)

**Files:**
- Create: `src/score.ts`
- Test: `src/score.test.ts`

Batch new items to Claude, one request per `SCORE_BATCH_SIZE`. Each request demands a strict JSON array — one object per input item, same order, no prose, no fences. Parse defensively, assert the count matches, then blend relevance with tier priority and source weight into a final `rank` and sort descending.

**Ranking formula (concrete):** `rank = relevance + TIER_PRIORITY[tier] + weight * 0.5`.
With relevance 0–10 dominating, tier adding 0–2, and weight (1–5) adding 0.5–2.5, relevance leads while tier and weight break ties in the intended priority order.

- [ ] **Step 1: Write the failing test (pure parse + rank logic)**

`score.ts` exposes `parseScores`, `blendRank`, and `rankAndSort` as pure functions so the Claude call is the only un-unit-tested part. Create `src/score.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { blendRank, capForBudget, parseScores, preScorePriority, rankAndSort } from "./score.js";
import type { FeedItem } from "./types.js";

function item(p: Partial<FeedItem>): FeedItem {
  return {
    id: p.id ?? "1", title: p.title ?? "t", link: p.link ?? "https://x/1",
    source: p.source ?? "s", tier: p.tier ?? "tools", weight: p.weight ?? 1,
    publishedAt: p.publishedAt ?? 0,
  };
}

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
    { relevance: 8, summary: "a", category: "ecosystem" as const },
    { relevance: 8, summary: "b", category: "agents-tooling" as const },
  ];
  const out = rankAndSort(items, scores);
  assert.equal(out[0]?.id, "b"); // tools+weight5 outranks awareness+weight1 at equal relevance
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: FAIL — cannot resolve `./score.js`.

- [ ] **Step 3: Write `src/score.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import {
  CATEGORIES,
  MAX_ITEMS_PER_RUN,
  PRICE_PER_INPUT_TOKEN,
  PRICE_PER_OUTPUT_TOKEN,
  SCORE_BATCH_SIZE,
  SCORING_MODEL,
  TIER_PRIORITY,
} from "./config.js";
import type { Category, FeedItem, Score, ScoredItem, Tier } from "./types.js";

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

function clampRelevance(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function safeCategory(value: unknown): Category {
  return CATEGORIES.includes(value as Category) ? (value as Category) : "ecosystem";
}

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

export function blendRank(relevance: number, tier: Tier, weight: number): number {
  return relevance + TIER_PRIORITY[tier] + weight * 0.5;
}

/** Priority used to decide which items survive the budget cap, before relevance is known. */
export function preScorePriority(tier: Tier, weight: number): number {
  return TIER_PRIORITY[tier] + weight * 0.5;
}

/** Cap items before scoring to bound API cost; drop lowest pre-score priority first. */
export function capForBudget(items: FeedItem[], limit = MAX_ITEMS_PER_RUN): FeedItem[] {
  if (items.length <= limit) return items;
  const sorted = [...items].sort(
    (a, b) => preScorePriority(b.tier, b.weight) - preScorePriority(a.tier, a.weight),
  );
  console.warn(`[score] capping ${items.length} → ${limit} items (dropped ${items.length - limit} lowest-priority to bound cost)`);
  return sorted.slice(0, limit);
}

/** Zip items with their scores, compute rank, sort descending. */
export function rankAndSort(items: FeedItem[], scores: Score[]): ScoredItem[] {
  const scored: ScoredItem[] = items.map((item, i) => {
    const s = scores[i] ?? { relevance: 0, summary: "", category: "ecosystem" as Category };
    return { ...item, ...s, rank: blendRank(s.relevance, item.tier, item.weight) };
  });
  return scored.sort((a, b) => b.rank - a.rank);
}

function buildUserPrompt(batch: FeedItem[]): string {
  const lines = batch.map((item, i) => `${i + 1}. [${item.source}] ${item.title}\n   ${item.link}`);
  return `Score these ${batch.length} items:\n\n${lines.join("\n")}`;
}

interface BatchResult {
  scores: Score[];
  inputTokens: number;
  outputTokens: number;
}

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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/score.ts src/score.test.ts && git commit -m "feat: batched Claude scoring with defensive parse and rank blend"
```

---

## Task 9: Render stage

**Files:**
- Create: `src/render.ts`
- Test: `src/render.test.ts`

Keep items at or above `RELEVANCE_THRESHOLD`, group by category in fixed order, and render clean markdown: an `H1` with the run date, an `H2` per non-empty category, each item a linked title with its one-line summary and a small source/relevance footnote.

- [ ] **Step 1: Write the failing test**

Create `src/render.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDigest } from "./render.js";
import type { ScoredItem } from "./types.js";

function scored(p: Partial<ScoredItem>): ScoredItem {
  return {
    id: p.id ?? "1", title: p.title ?? "Title", link: p.link ?? "https://x/1",
    source: p.source ?? "Src", tier: p.tier ?? "tools", weight: p.weight ?? 1,
    publishedAt: p.publishedAt ?? 0, relevance: p.relevance ?? 8,
    summary: p.summary ?? "A summary.", category: p.category ?? "engineering",
    rank: p.rank ?? 8,
  };
}

test("renderDigest drops items below the relevance threshold", () => {
  const md = renderDigest([scored({ title: "Keep", relevance: 8 }), scored({ id: "2", title: "Drop", relevance: 2 })], "2026-06-09");
  assert.match(md, /Keep/);
  assert.doesNotMatch(md, /Drop/);
});

test("renderDigest groups by category heading and links titles", () => {
  const md = renderDigest([scored({ title: "Rel", category: "model-release", link: "https://x/r" })], "2026-06-09");
  assert.match(md, /# AI\/Agents Digest — 2026-06-09/);
  assert.match(md, /## Model Releases/);
  assert.match(md, /\[Rel\]\(https:\/\/x\/r\)/);
});

test("renderDigest reports an empty digest gracefully", () => {
  const md = renderDigest([], "2026-06-09");
  assert.match(md, /# AI\/Agents Digest — 2026-06-09/);
  assert.match(md, /No items/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: FAIL — cannot resolve `./render.js`.

- [ ] **Step 3: Write `src/render.ts`**

```typescript
import { CATEGORIES, CATEGORY_TITLES, RELEVANCE_THRESHOLD } from "./config.js";
import type { Category, ScoredItem } from "./types.js";

function renderItem(item: ScoredItem): string {
  const footnote = `*${item.source} · relevance ${item.relevance}/10*`;
  return `- [${item.title}](${item.link}) — ${item.summary}\n  ${footnote}`;
}

/** Markdown digest grouped by category, threshold-filtered, dated. */
export function renderDigest(items: ScoredItem[], date: string): string {
  const kept = items.filter((i) => i.relevance >= RELEVANCE_THRESHOLD);
  const lines: string[] = [`# AI/Agents Digest — ${date}`, ""];

  if (kept.length === 0) {
    lines.push("_No items cleared the relevance threshold this week._");
    return `${lines.join("\n")}\n`;
  }

  const byCategory = new Map<Category, ScoredItem[]>();
  for (const item of kept) {
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push(item);
    byCategory.set(item.category, bucket);
  }

  for (const category of CATEGORIES) {
    const bucket = byCategory.get(category);
    if (!bucket || bucket.length === 0) continue;
    lines.push(`## ${CATEGORY_TITLES[category]}`, "");
    for (const item of bucket) lines.push(renderItem(item));
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/render.ts src/render.test.ts && git commit -m "feat: markdown digest rendering grouped by category"
```

---

## Task 10: Email stage (best-effort, Gmail SMTP)

**Files:**
- Create: `src/email.ts`
- Test: `src/email.test.ts`

Convert rendered markdown to simple inline-styled HTML and send via Gmail SMTP with `nodemailer`, authenticating with a Gmail app password. Read `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `DIGEST_TO` (defaulting to `GMAIL_USER`). If creds are absent, skip and log — local runs work without them. Wrap the send so failure never crashes the run.

- [ ] **Step 1: Write the failing test (pure markdown→HTML)**

Only the pure converter is unit-tested; SMTP is verified live in Step 7. Create `src/email.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: FAIL — cannot resolve `./email.js`.

- [ ] **Step 3: Write `src/email.ts`**

A deliberately small line-based markdown→HTML converter (the digest's markdown is a fixed, simple subset — headings, bullet list items with a link, italic footnotes — so a full markdown lib is unnecessary).

```typescript
import nodemailer from "nodemailer";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline-style markdown links and bold/italic within an already-escaped line. */
function renderInline(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" style="color:#0b5cad;text-decoration:none">$1</a>')
    .replace(/\*([^*]+)\*/g, '<span style="color:#666;font-size:12px">$1</span>');
}

/** Convert the digest's simple markdown subset to inline-styled HTML. */
export function markdownToHtml(markdown: string): string {
  const body = markdown
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "") return "";
      const esc = escapeHtml(trimmed);
      if (trimmed.startsWith("# ")) return `<h1 style="font-family:sans-serif;font-size:22px">${renderInline(esc.slice(2))}</h1>`;
      if (trimmed.startsWith("## ")) return `<h2 style="font-family:sans-serif;font-size:18px;border-bottom:1px solid #eee;padding-bottom:4px">${renderInline(esc.slice(3))}</h2>`;
      if (trimmed.startsWith("- ")) return `<p style="font-family:sans-serif;font-size:14px;margin:8px 0">${renderInline(esc.slice(2))}</p>`;
      return `<p style="font-family:sans-serif;font-size:14px;color:#666;margin:2px 0 8px">${renderInline(esc)}</p>`;
    })
    .join("\n");
  return `<div style="max-width:680px;margin:0 auto;color:#111">${body}</div>`;
}

/** Send the digest via Gmail SMTP. Best-effort: never throws. */
export async function sendDigest(subject: string, markdown: string): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log("[email] GMAIL_USER/GMAIL_APP_PASSWORD unset — skipping send");
    return;
  }
  const to = process.env.DIGEST_TO || user;
  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transport.sendMail({
      from: user,
      to,
      subject,
      text: markdown,
      html: markdownToHtml(markdown),
    });
    console.log(`[email] sent digest to ${to}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[email] send failed (continuing): ${reason}`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/eyalpolitansky/ai-news && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/email.ts src/email.test.ts && git commit -m "feat: best-effort Gmail SMTP digest email with inline HTML"
```

- [ ] **Step 7: Verify SMTP live against a real Gmail app password**

SMTP cannot be meaningfully tested without real credentials. **Ask the user** to provide a Gmail app password (the account must have 2FA enabled — an ordinary password will not work) and run a one-off send. Suggest the user run this in the session so output lands in the conversation (the `!` prefix runs a shell command):

```
! GMAIL_USER='10eyal10@gmail.com' GMAIL_APP_PASSWORD='xxxx xxxx xxxx xxxx' DIGEST_TO='10eyal10@gmail.com' npx tsx -e "import('./src/email.js').then(m => m.sendDigest('AI digest SMTP test', '# Test\n\n## Section\n\n- [Example](https://example.com) — a test item\n  *test · relevance 9/10*'))"
```
Expected: console prints `[email] sent digest to 10eyal10@gmail.com` and the message arrives in the inbox. If it fails with an auth error, confirm 2FA is on and the app password is correct. Do not claim email works until a real send succeeds.

---

## Task 11: Orchestrator (main entry point)

**Files:**
- Create: `src/digest.ts`

Run the stages in order: fetch → filter against seen-store → score → render → **write `digests/YYYY-MM-DD.md`** → **save pruned seen-store** → email. The digest is written and the seen-store saved *before* email is attempted, so email is never in the critical path.

- [ ] **Step 1: Write `src/digest.ts`**

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { fetchAll } from "./fetch.js";
import { filterNew, loadSeen, prune, recordSeen, saveSeen } from "./seen-store.js";
import { scoreItems } from "./score.js";
import { renderDigest } from "./render.js";
import { sendDigest } from "./email.js";

/** YYYY-MM-DD in UTC, so digest filenames are stable regardless of runner timezone. */
function isoDate(now: Date): string {
  const part = now.toISOString().slice(0, 10);
  return part;
}

async function main(): Promise<void> {
  const now = Date.now();
  const date = isoDate(new Date(now));

  const fetched = await fetchAll(now);
  console.log(`[digest] fetched ${fetched.length} items in window`);

  const seen = await loadSeen();
  const fresh = filterNew(fetched, seen);
  console.log(`[digest] ${fresh.length} new after dedup against seen-store`);

  const scored = await scoreItems(fresh);

  const markdown = renderDigest(scored, date);
  const path = `digests/${date}.md`;
  await mkdir("digests", { recursive: true });
  await writeFile(path, markdown, "utf8");
  console.log(`[digest] wrote ${path}`);

  // Persist dedup state *before* email — email must never block committing results.
  recordSeen(fresh, seen, now);
  await saveSeen(prune(seen, now));
  console.log("[digest] saved seen-store");

  await sendDigest(`AI/Agents Digest — ${date}`, markdown);
}

main().catch((err) => {
  console.error("[digest] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Real local run (produces a digest)**

Requires `ANTHROPIC_API_KEY`. **Before the first run, confirm the user has set a monthly spend
limit (e.g. $1) in the Anthropic Console** (Billing → Limits / Usage limits) as the hard cost
backstop — the in-code `MAX_ITEMS_PER_RUN` cap bounds tokens, but the Console limit is what
physically prevents exceeding the budget. Then ask the user to run it in-session so the API key
stays in their environment:
```
! ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY npm run digest
```
Expected: logs for fetched/new counts, `wrote digests/YYYY-MM-DD.md`, `saved seen-store`, and an email skip or send line. Open `digests/<date>.md` and confirm it's a sensible, grouped digest with linked titles and summaries. If scoring errors on a batch (count mismatch), inspect the raw model output and tighten the prompt; re-run.

- [ ] **Step 4: Commit (code + first generated digest + seen-store)**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/digest.ts digests state && git commit -m "feat: orchestrator entry point; first generated digest + seen-store"
```

---

## Task 12: Discovery (independent entry point)

**Files:**
- Create: `src/discovery.ts`

A small, independent script that reads the commit Atom feeds of one or two "awesome-list" repos for AI agents and prints recently-added entries, so the user can periodically find new sources. Kept fully separate from the main run.

- [ ] **Step 1: Write `src/discovery.ts`**

GitHub exposes a per-branch commit Atom feed at `https://github.com/{org}/{repo}/commits/{branch}.atom`. We surface recent commit titles (which, for awesome-lists, are usually "Add <thing>") for the user to scan.

```typescript
import Parser from "rss-parser";

interface AwesomeList {
  name: string;
  org: string;
  repo: string;
  branch: string;
}

const LISTS: AwesomeList[] = [
  { name: "e2b-dev/awesome-ai-agents", org: "e2b-dev", repo: "awesome-ai-agents", branch: "main" },
  { name: "kyrolabs/awesome-langchain", org: "kyrolabs", repo: "awesome-langchain", branch: "main" },
];

const parser = new Parser({ timeout: 20000 });

async function main(): Promise<void> {
  for (const list of LISTS) {
    const url = `https://github.com/${list.org}/${list.repo}/commits/${list.branch}.atom`;
    console.log(`\n## ${list.name}`);
    try {
      const feed = await parser.parseURL(url);
      const recent = (feed.items ?? []).slice(0, 15);
      for (const item of recent) {
        const title = item.title?.split("\n")[0]?.trim() ?? "(no title)";
        const when = item.isoDate?.slice(0, 10) ?? "";
        console.log(`- ${when}  ${title}`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`  skipped: ${reason}`);
    }
  }
}

main().catch((err) => {
  console.error("[discovery] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/eyalpolitansky/ai-news && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run discovery to confirm the awesome-list feeds parse**

Run:
```bash
cd /Users/eyalpolitansky/ai-news && npm run discovery
```
Expected: a `## repo` heading per list followed by recent dated commit lines. If a repo's default branch isn't `main` (some use `master`) or the repo moved, adjust the `LISTS` entry until at least one list prints entries. Do not assert these URLs work from memory — confirm via this run.

- [ ] **Step 4: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add src/discovery.ts && git commit -m "feat: independent awesome-list source-discovery script"
```

---

## Task 13: GitHub Actions weekly workflow

**Files:**
- Create: `.github/workflows/digest.yml`

Runs weekly on cron (and manual dispatch), installs deps, runs the digest, commits new `digests/` files and `state/seen.json`. The cron cadence (weekly) must agree with `LOOKBACK_DAYS = 8` in config.

- [ ] **Step 1: Write `.github/workflows/digest.yml`**

```yaml
name: Weekly AI Digest

on:
  schedule:
    # Mondays 13:00 UTC. Weekly — agrees with LOOKBACK_DAYS=8 (one day of overlap).
    - cron: "0 13 * * 1"
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - run: npm ci

      - name: Generate digest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          DIGEST_TO: ${{ secrets.DIGEST_TO }}
        run: npm run digest

      - name: Commit digest and dedup state
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add digests state
          if git diff --cached --quiet; then
            echo "No changes to commit."
          else
            git commit -m "chore: weekly digest $(date -u +%Y-%m-%d)"
            git push
          fi
```

- [ ] **Step 2: Lint the YAML by inspection**

Confirm: cron is weekly (`* * 1`), `permissions: contents: write` is present (needed to push), all four secrets are passed, and the commit step no-ops cleanly when there's nothing new. There is no local runner for this; correctness is verified on first dispatch after pushing to GitHub.

- [ ] **Step 3: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add .github/workflows/digest.yml && git commit -m "ci: weekly digest workflow committing digests and dedup state"
```

---

## Task 14: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# AI/Agents Weekly News Digest

A low-maintenance weekly digest of AI/agents news for a hands-on LLM/agent builder.
It pulls tiered RSS/Atom feeds, removes items seen in past runs, scores each remaining
item with Claude for builder-relevance, renders a topic-grouped markdown digest, emails
it (best-effort), and commits the digest plus dedup state. Every digest is committed, so
the repo doubles as a searchable archive — no database, no server.

## How it works

```
sources → fetch → dedupe (seen-store) → score (Claude) → render → write digest → save state → email
```

Each stage is one module in `src/`. See `docs/superpowers/plans/` for the original plan.

## Setup

1. Node 22 (Node 20 also works). Install deps:
   ```bash
   npm install
   ```
2. Set environment variables (see below).
3. Generate a digest:
   ```bash
   npm run digest
   ```
   It writes `digests/YYYY-MM-DD.md` and updates `state/seen.json`.

## Scripts

- `npm run digest` — run the full pipeline (the main entry point).
- `npm run discovery` — print recently-added entries from awesome-list repos, to find new sources.
- `npm run typecheck` — `tsc --noEmit`, strict.
- `npm test` — unit tests (`node:test`).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes (for scoring) | Authenticates the Claude scoring call. |
| `GMAIL_USER` | No | Gmail address used to send the digest. |
| `GMAIL_APP_PASSWORD` | No | Gmail **app password** (account must have 2FA enabled). |
| `DIGEST_TO` | No | Recipient; defaults to `GMAIL_USER`. |

If the Gmail vars are unset, email is skipped and logged — local runs work without them.

## Cost & billing cap

Scoring runs on the **Anthropic API** (`@anthropic-ai/sdk`), which is billed pay-as-you-go
from API credits at `console.anthropic.com` — **separate from a Claude Pro/Max subscription**,
which it does not touch. Using `claude-haiku-4-5`, a weekly run costs a few cents; expect
well under **$1/month**. Each run logs its actual token usage and estimated cost (`[score] … ~$0.0xxx`).

Two layers keep cost bounded:

1. **In-code item cap** — `MAX_ITEMS_PER_RUN` in `src/config.ts` (default 150) limits how many
   items are sent to Claude per run. Lowest-priority items (low tier + weight) are dropped first,
   and the drop is logged. This bounds per-run token cost regardless of how noisy the feeds get.
2. **Hard billing cap (the real backstop)** — in the Anthropic Console, set a low **monthly spend
   limit** (e.g. **$1**) under **Billing → Limits / Usage limits**. Once hit, the API stops serving
   requests, so spend physically cannot exceed it. The digest still writes whatever it scored before
   the cap; only scoring of further items is affected. Confirm the exact menu label in your Console —
   the budget/usage-limit setting is what enforces the ceiling.

## Adding a source

Edit `src/sources.ts` and append a `Source` to `SOURCES`:

```ts
{ name: "My Feed", url: "https://example.com/feed.xml", tier: "learning", weight: 3 }
```

- `tier` is `tools` > `learning` > `awareness` (priority order).
- `weight` is 1–5 (relative importance, blended into the final rank).
- For GitHub release feeds use the helper: `githubReleases("org", "repo")`.

Verify a new feed actually parses before relying on it (run `npm run digest` and check it
appears, or temporarily log fetched items).

## Tuning

`src/config.ts` holds the knobs: lookback window, seen-store prune age, relevance threshold,
scoring model, batch size, tier priorities, and the category set.

## Automation

`.github/workflows/digest.yml` runs weekly (Mondays 13:00 UTC) and on manual dispatch,
then commits new digests and dedup state. Add `ANTHROPIC_API_KEY`, `GMAIL_USER`,
`GMAIL_APP_PASSWORD`, and `DIGEST_TO` as repository secrets. The cron cadence and the
`LOOKBACK_DAYS` window in `src/config.ts` are kept in agreement (weekly + 8-day window).
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add README.md && git commit -m "docs: README with setup, env vars, and adding sources"
```

---

## Task 15: Rewrite CLAUDE.md and final verification

**Files:**
- Modify: `CLAUDE.md` (replace the spec with concise real-architecture guidance)

- [ ] **Step 1: Replace `CLAUDE.md` with real guidance**

The current `CLAUDE.md` is the build spec. Now that the code exists, replace it with concise guidance for future work:

```markdown
# CLAUDE.md

Weekly AI/agents news digest for a hands-on LLM/agent builder. Boring and
low-maintenance by design: a few small `tsx`-run TypeScript modules, no DB, no server.

## Architecture

One-directional pipeline, one module per stage in `src/`:

`sources.ts → fetch.ts → seen-store.ts (dedupe) → score.ts (Claude) → render.ts → digest.ts writes digests/YYYY-MM-DD.md → seen-store saved → email.ts (best-effort)`

- `config.ts` — all tunables (lookback window, prune age, relevance threshold, model, batch size, tier priorities, categories).
- `types.ts` — shared types.
- `digest.ts` — orchestrator (main entry). Writes the digest and saves dedup state **before** attempting email; email never blocks the critical path.
- `discovery.ts` — independent script to surface new candidate sources from awesome-list repos.
- Persistence: committed `digests/*.md` (the archive) + `state/seen.json` (dedup state). No other infrastructure.

## Conventions

- ESM with `.js` import specifiers for local `.ts` files.
- Strict TS with `noUncheckedIndexedAccess`; run `npm run typecheck` after changes.
- Comments explain *why*, not *what*.
- Scoring uses `claude-haiku-4-5` (cheap/fast batch classification). Update the id in `config.ts` if migrating models.
- Don't assert a feed URL works from memory — verify it parses (run the digest, or check `discovery`).

## Scripts

`npm run digest` (main), `npm run discovery`, `npm run typecheck`, `npm test`.

## Where things live

- Add/remove feeds: `src/sources.ts`.
- Change scoring behavior or ranking blend: `src/score.ts`.
- Change digest layout: `src/render.ts`.
- Change cadence: `.github/workflows/digest.yml` cron **and** `LOOKBACK_DAYS` in `src/config.ts` (keep them in agreement).
```

- [ ] **Step 2: Final full verification**

Run all three gates:
```bash
cd /Users/eyalpolitansky/ai-news && npm run typecheck && npm test
```
Expected: typecheck exits 0; all tests pass.

- [ ] **Step 3: Confirm the deliverables checklist**

Verify each is true and state the evidence (do not assert without checking):
- [ ] All pipeline stages implemented, typecheck clean.
- [ ] `src/sources.ts` seeded with feeds across all three tiers, each verified to parse (Task 5).
- [ ] A real local run produced a sensible `digests/YYYY-MM-DD.md` (Task 11).
- [ ] Cost bounded two ways: `MAX_ITEMS_PER_RUN` in-code cap (Task 3/8) + a $1 monthly Console spend limit set by the user (Task 11, Step 3); per-run cost is logged.
- [ ] Email verified locally against a real Gmail app password (Task 10, Step 7).
- [ ] Weekly GitHub Actions workflow present, committing digests + state (Task 13).
- [ ] README documents setup, env vars, and adding a source (Task 14).
- [ ] This `CLAUDE.md` reflects the real architecture (this task).

- [ ] **Step 4: Commit**

```bash
cd /Users/eyalpolitansky/ai-news && git add CLAUDE.md && git commit -m "docs: replace build spec with real-architecture guidance"
```

---

## Self-review notes (addressed)

- **Spec coverage:** sources (T4) + verification (T5); fetch/window/dedup (T6); seen-store/prune (T7); batched scoring/strict-JSON/defensive-parse/count-assert/rank blend (T8); threshold render grouped by category (T9); Gmail SMTP best-effort email + local verify (T10); orchestrator writing digest before email (T11); discovery (T12); weekly workflow with agreeing cadence (T13); README (T14); CLAUDE.md rewrite (T15). All present.
- **Model choice:** `claude-haiku-4-5` chosen for cheap/fast batch classification per the claude-api guidance; id isolated in `config.ts` for easy migration.
- **Type consistency:** `ScoredItem` extends `FeedItem & Score` with `rank`; `parseScores`/`blendRank`/`rankAndSort`/`scoreItems` signatures consistent across T8 and its callers in T11; `SeenStore`/`filterNew`/`recordSeen`/`prune`/`loadSeen`/`saveSeen` consistent across T7 and T11; `renderDigest(items, date)` consistent across T9 and T11.
- **Cadence agreement:** cron weekly (`0 13 * * 1`) ↔ `LOOKBACK_DAYS = 8`, documented in both the workflow and config.
```
