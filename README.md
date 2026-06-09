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
