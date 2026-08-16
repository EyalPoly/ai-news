# CLAUDE.md

Weekly AI/agents news digest for a hands-on LLM/agent builder. Boring and
low-maintenance by design: a few small `tsx`-run TypeScript modules, no DB, no server.

## Architecture

One-directional pipeline, one module per stage in `src/`:

`sources.ts → fetch.ts → seen-store.ts (dedupe) → score.ts (Claude) → render.ts → digest.ts writes digests/YYYY-MM-DD.md → seen-store saved → email.ts (best-effort) → podcast.ts writes feed.xml + episode MP3 (Gemini; best-effort)`

- `config.ts` — all tunables (lookback window, prune age, relevance threshold, model, batch size, tier priorities, categories).
- `types.ts` — shared types.
- `digest.ts` — orchestrator (main entry). Writes the digest and saves dedup state **before** attempting email; email never blocks the critical path.
- `discovery.ts` — independent script to surface new candidate sources from awesome-list repos.
- Persistence: committed `digests/*.md` (the archive) + `state/seen.json` (dedup state). No other infrastructure.

## Conventions

- ESM with `.js` import specifiers for local `.ts` files.
- Strict TS with `noUncheckedIndexedAccess`; run `npm run typecheck` after changes.
- Comments explain *why*, not *what*.
- Scoring provider is configurable via `SCORING_PROVIDER` in `config.ts`/env: `anthropic` (default, `claude-haiku-4-5`) or `openai-compatible` (any OpenAI-style `/chat/completions` endpoint — Gemini free tier, self-hosted, etc.). Update `SCORING_MODEL` or `LLM_MODEL` in `config.ts` if migrating models.
- Don't assert a feed URL works from memory — verify it parses (run the digest, or check `discovery`).
- Tests are flat `src/*.test.ts` files run by `node:test`; the `npm test` glob is single-level (`src/*.test.ts`) so it works on Node 20 and 22 alike.

## Scripts

`npm run digest` (main), `npm run discovery`, `npm run typecheck`, `npm test`.

## Where things live

- Add/remove feeds: `src/sources.ts`.
- Change scoring behavior or ranking blend: `src/score.ts`.
- Change digest layout: `src/render.ts`.
- Change cadence: `.github/workflows/digest.yml` cron **and** `LOOKBACK_DAYS` in `src/config.ts` (keep them in agreement).
- Change episode selection or length: `PODCAST_*` in `src/config.ts`.
- Change the dialogue prompt: `buildScriptPrompt` in `src/script.ts`.
- Change the feed's channel metadata: `src/feed.ts` + `PODCAST_*` in `src/config.ts`.
- The podcast block reads the *committed digest*, not the in-memory scored array —
  that is what makes a failed episode retryable by re-running the workflow.
