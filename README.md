# AI/Agents Weekly News Digest

A low-maintenance weekly digest of AI/agents news for a hands-on LLM/agent builder.
It pulls tiered RSS/Atom feeds, removes items seen in past runs, scores each remaining
item with an LLM for builder-relevance (Claude by default, or any OpenAI-compatible
endpoint), renders a topic-grouped markdown digest, emails it (best-effort), and commits
the digest plus dedup state. Every digest is committed, so the repo doubles as a
searchable archive — no database, no server.

## How it works

```
sources → fetch → dedupe (seen-store) → score (LLM) → render → write digest → save state → email
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
| `SCORING_PROVIDER` | No | `anthropic` (default) or `openai-compatible`. See below. |
| `ANTHROPIC_API_KEY` | Yes, if `SCORING_PROVIDER=anthropic` | Authenticates the Claude scoring call. |
| `LLM_ENDPOINT` | Yes, if `SCORING_PROVIDER=openai-compatible` | Base URL of an OpenAI-compatible chat-completions endpoint (e.g. Gemini's free-tier API, or a self-hosted server). |
| `LLM_API_KEY` | No | Bearer token for `LLM_ENDPOINT`. Omit if your endpoint doesn't require auth. |
| `LLM_MODEL` | Yes, if `SCORING_PROVIDER=openai-compatible` | Model name sent in the request body. |
| `GMAIL_USER` | No | Gmail address used to send the digest. |
| `GMAIL_APP_PASSWORD` | No | Gmail **app password** (account must have 2FA enabled). |
| `DIGEST_TO` | No | Recipient; defaults to `GMAIL_USER`. |

If the Gmail vars are unset, email is skipped and logged — local runs work without them.

## Using an OpenAI-compatible scoring provider

Set `SCORING_PROVIDER=openai-compatible` to score with anything that exposes an
OpenAI-style `/chat/completions` endpoint instead of Claude — for example
Gemini's free tier. `gemini-3.5-flash-lite` is a good fit: Flash-Lite is the
only Gemini tier that's free of charge across all usage tiers (Flash and Pro
are free only in the Standard tier), and it's plenty for a title-only
relevance/category classification task at this project's volume (~6 batched
requests/week):

```bash
SCORING_PROVIDER=openai-compatible
LLM_ENDPOINT=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=<your Gemini API key>
LLM_MODEL=gemini-3.5-flash-lite
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

## Cost & billing cap

This section applies when `SCORING_PROVIDER=anthropic` (the default). Scoring runs on the
**Anthropic API** (`@anthropic-ai/sdk`), which is billed pay-as-you-go from API credits at
`console.anthropic.com` — **separate from a Claude Pro/Max subscription**, which it does not
touch. Using `claude-haiku-4-5`, a weekly run costs a few cents; expect well under **$1/month**.
Each run logs its actual token usage and estimated cost (`[score] … ~$0.0xxx`).

With `SCORING_PROVIDER=openai-compatible`, cost depends entirely on your endpoint (e.g. free
under Gemini's free tier, or $0 for a self-hosted server) — the run logs token counts without
a cost estimate, since pricing for an arbitrary endpoint isn't known.

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
then commits new digests and dedup state. Add `ANTHROPIC_API_KEY` (or `SCORING_PROVIDER`,
`LLM_ENDPOINT`, `LLM_API_KEY`, `LLM_MODEL` for the openai-compatible path), `GMAIL_USER`,
`GMAIL_APP_PASSWORD`, and `DIGEST_TO` as repository secrets. The cron cadence and the
`LOOKBACK_DAYS` window in `src/config.ts` are kept in agreement (weekly + 8-day window).
