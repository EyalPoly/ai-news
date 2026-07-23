# Configurable scoring provider (Anthropic + OpenAI-compatible)

## Context

`score.ts` is the only place this project calls an LLM. It currently sends
title + source + link (no article body) to `claude-haiku-4-5` and asks for
three things per item: a 0–10 relevance score, a one-sentence summary, and a
category label.

Two changes are motivated by review of that step:

1. The summary field only rephrases the title (there's no article body to
   summarize), so it earns little for the tokens/complexity it costs. Drop it.
2. The project should support an OpenAI-compatible endpoint as an alternative
   to Anthropic — e.g. Gemini's free-tier API
   (`https://generativelanguage.googleapis.com/v1beta/openai/`) today, or a
   self-hosted server (Ollama/vLLM/etc.) later — selected via config, without
   removing the existing Anthropic path.

Relevance scoring and categorization both require semantic judgment on short,
novel text (new tool/model names every week) that keyword rules can't
sustain without constant maintenance — that's the part an LLM actually earns
its place for. The summary field doesn't have that justification, hence its
removal.

## Scope

In scope: `score.ts` provider split, retry/backoff, schema change (drop
summary), config additions, render/test updates, docs.

Out of scope: changing what's scored (still relevance + category), changing
the pipeline shape (`sources → fetch → dedupe → score → render → digest`
stays the same), adding a third provider, migrating the existing digest
archive.

## Design

### Config (`config.ts`)

New:
- `SCORING_PROVIDER: "anthropic" | "openai-compatible"` — default
  `"anthropic"` so existing setups keep working unchanged.
- `LLM_ENDPOINT` — base URL for the OpenAI-compatible path (e.g. Gemini's
  OpenAI-compat base, or a self-hosted server's URL). Required when
  `SCORING_PROVIDER=openai-compatible`.
- `LLM_API_KEY` — bearer token for that endpoint. Optional (some self-hosted
  setups don't require auth).
- `LLM_MODEL` — model name sent in the request body for that path.

Unchanged: `ANTHROPIC_API_KEY`, `SCORING_MODEL` — still used by the Anthropic
path.

`PRICE_PER_INPUT_TOKEN` / `PRICE_PER_OUTPUT_TOKEN` stay Anthropic-specific;
they're not meaningful for an arbitrary/free third-party endpoint.

### Types (`types.ts`)

`Score` drops `summary`:

```ts
export interface Score {
  relevance: number; // 0–10
  category: Category;
}
```

### Scoring (`score.ts`)

- `SYSTEM_PROMPT` updated: asks only for `relevance` and `category` per item.
- Response schema changes from a bare JSON array to `{"scores": [...]}`. Most
  OpenAI-compatible servers' `response_format: {type: "json_object"}` mode
  expects a top-level JSON object, not an array; this shape works for both
  providers so `parseScores` stays shared.
- Provider split: `scoreItems` picks a batch-calling function based on
  `SCORING_PROVIDER`:
  - **Anthropic** — existing `@anthropic-ai/sdk` call, adapted to the new
    schema.
  - **OpenAI-compatible** — new function, plain `fetch` to
    `{LLM_ENDPOINT}/chat/completions` with `Authorization: Bearer
    {LLM_API_KEY}` (header omitted if no key configured), `model:
    LLM_MODEL`, `response_format: {type: "json_object"}`.
  - Both return the same `{ scores, inputTokens, outputTokens }` shape, so
    `parseScores`, `rankAndSort`, `capForBudget`, `blendRank` are untouched.
- Shared retry: `withRetry(fn, attempts = 3, baseDelayMs = 1000)` wraps
  whichever batch call, retrying on HTTP 429/5xx with exponential backoff.
  Applied to both providers uniformly (simpler than conditional logic;
  low-risk for Anthropic, meaningfully more resilient for a free-tier
  endpoint with real rate limits).
- Cost log line: for Anthropic, keep the existing `~$X.XXXX` estimate. For
  `openai-compatible`, log input/output token counts without a cost estimate
  (pricing is unknown/not applicable for an arbitrary or free endpoint).

### Render (`render.ts`)

`renderItem` drops the summary segment:

```ts
// before: `- [${item.title}](${item.link}) — ${item.summary}\n  ${footnote}`
// after:  `- [${item.title}](${item.link})\n  ${footnote}`
```

### Error handling

Unchanged from today: a scoring failure (after retries are exhausted) is
fatal to the whole run — `scoreItems` throws, `main().catch` in `digest.ts`
logs and exits 1. No fallback between providers, no partial digest. This
matches the project's existing behavior and low-maintenance philosophy;
retry handles *transient* failures, it doesn't paper over a misconfigured or
down endpoint.

### CI / secrets (`.github/workflows/digest.yml`)

Add `SCORING_PROVIDER`, `LLM_ENDPOINT`, `LLM_API_KEY`, `LLM_MODEL` as
optional env vars sourced from repo secrets, alongside the existing
`ANTHROPIC_API_KEY`. Only the variables relevant to the configured provider
need to be set.

### Docs

- `README.md` — document the new env vars and how to point at Gemini's free
  tier or a self-hosted OpenAI-compatible server.
- `CLAUDE.md` — update the "Scoring uses `claude-haiku-4-5`" convention note
  to describe the configurable provider and where to change it.

## Testing

- `score.test.ts` — update fixtures/assertions for the summary-less schema;
  add coverage for the OpenAI-compatible request/response path and the retry
  wrapper (retries on 429, gives up after max attempts).
- Verify `response_format: json_object` support against the actual
  configured endpoint before relying on it — don't assume from memory that
  Gemini's OpenAI-compat layer or a given self-hosted server honors it. If
  unsupported, fall back to prompt-only JSON enforcement (how the Anthropic
  path already works today via `parseScores`' fence-stripping).
- `render.test.ts` — update expected output to drop the summary segment.

## Files touched

`src/config.ts`, `src/types.ts`, `src/score.ts`, `src/score.test.ts`,
`src/render.ts`, `src/render.test.ts`, `.github/workflows/digest.yml`,
`README.md`, `CLAUDE.md`.
