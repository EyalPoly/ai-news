# CLAUDE.md

This repo is empty by design. It contains only this spec. Your job is to implement the
entire project described below from scratch. Read this whole file before writing code,
then follow the Explore → Plan → Implement workflow: explore what little exists, propose
a plan and file layout, then build it stage by stage, verifying as you go.

## What to build

A weekly AI/agents news aggregator for a senior software engineer who builds LLM-powered
systems and agent tooling. It pulls a tiered set of RSS/Atom feeds, removes items already
seen in past runs, scores each remaining item with Claude for relevance to a hands-on
builder, renders a markdown digest grouped by topic, emails it to a fixed inbox, and
commits it. Runs unattended weekly via GitHub Actions. Because every digest is committed,
the repo doubles as a searchable archive — no database or web server needed.

## Hard constraints

- **Least maintenance is the top priority**, ahead of features and cleverness. Prefer
  boring, declarative solutions.
- **No database, no web server, no frontend.** Persistence is a flat file for dedup state
  plus committed markdown files. Do not add infrastructure beyond this.
- The digest must be produced and committed even if email fails — email is best-effort,
  layered on top, never in the critical path.
- The whole thing is a few small scripts plus one scheduled workflow. If a design needs
  more than that, it's too complex — reconsider.

## Stack

- TypeScript, ESM, Node 22, run directly with `tsx` (no build step).
- `tsc --noEmit` for typechecking, with strict mode and `noUncheckedIndexedAccess` on.
- Anthropic SDK (`@anthropic-ai/sdk`) for scoring. An RSS/Atom parser library for feeds.
  `nodemailer` for email. Pick versions yourself; keep dependencies minimal.
- Choose a current Claude model for scoring (verify what's available rather than assuming
  a name from memory).

## Pipeline (design as discrete stages)

Implement as small single-purpose modules; data flows one direction through them:

1. **Sources** — a declarative, easily-editable list of feeds. Each feed has: a name, a
   URL, a tier (`tools` > `learning` > `awareness`, in that priority order), and a numeric
   weight. This is the file the user edits most, so keep it clean and comment the tiers.
   Seed it with feeds across all three tiers covering: AI-engineering newsletters,
   filtered Hacker News, GitHub release feeds for major agent frameworks, a couple of
   deep research/technique sources, an arXiv query feed, and official lab blogs. Provide
   a small helper for the GitHub releases URL pattern
   (`https://github.com/{org}/{repo}/releases.atom`). Verify each seeded URL actually
   parses before considering the task done — do not assert a URL works on memory.

2. **Fetch** — pull all feeds in parallel, filter to a look-back window slightly longer
   than the run cadence (so nothing slips between runs), normalize entries to a common
   item shape, and dedupe within the batch by a content hash of link/title (on collision,
   keep the higher-weight source). A single feed failing must not abort the run: log it
   and continue with the rest.

3. **Seen-store** — a flat JSON file mapping item IDs to timestamps, so items are only
   ever processed once across weekly runs. Prune entries older than a few months. This is
   what makes runs idempotent.

4. **Score** — batch the new items to Claude in one call per batch. For each item, get a
   relevance score (0–10), a one-sentence summary, and a category from a fixed set
   (e.g. model-release, agents-tooling, technique-research, engineering, ecosystem).
   Demand strict JSON output: a JSON array, one object per input item, same order, no
   prose, no markdown fences. Parse defensively and assert the count matches the input.
   Compute a final rank that blends the model's relevance with the source weight and tier
   priority, and sort by it.

5. **Render** — group kept items (above a relevance threshold) by category into clean
   markdown: a heading per category, each item a linked title with its one-line summary
   and a small source/relevance footnote. Make the threshold easy to change.

6. **Email** — convert the rendered markdown to simple inline-styled HTML and send it via
   **Gmail SMTP** using `nodemailer`. Authenticate with a Gmail **app password** (the
   account must have 2FA enabled; an ordinary password will not work). Read config from
   env: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and `DIGEST_TO` (default the recipient to
   `GMAIL_USER` if `DIGEST_TO` is unset). If these env vars are absent, skip sending and
   log it, so local runs work without credentials. Wrap the send in try/catch so a failure
   never crashes the run or loses the already-written digest.

7. **Orchestrator (entry point)** — run the stages in order: fetch → dedupe against
   seen-store → score → render → write `digests/YYYY-MM-DD.md` → save seen-store → email.
   Write and persist the digest *before* attempting email.

8. **Discovery (separate entry point)** — a small script that reads the commit/Atom feeds
   of one or two "awesome-list" repos for AI agents and prints recently-added entries, so
   the user can periodically find new sources to add. Keep it independent of the main run.

## Automation

A GitHub Actions workflow that runs weekly on a cron (and supports manual dispatch),
installs deps, runs the digest, and commits new files under `digests/` and the dedup
state. Pass `ANTHROPIC_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and `DIGEST_TO` from
repo secrets. The look-back window in the fetch stage and the cron cadence must agree.

## Scripts to expose

- one to generate the digest (the main entry point),
- one to run discovery,
- one to typecheck.

## Conventions to follow

- ESM with `.js` import specifiers for local `.ts` files (required by Node ESM
  resolution).
- Comments explain *why*, not *what*; let clear code and names carry the rest.
- After any series of changes, run the typecheck script and get it clean.
- Don't claim a feed URL or an SMTP setup works without actually verifying it. SMTP in
  particular can only be meaningfully tested with a real app password, so verify email
  locally before wiring it into the workflow.

## Deliverables checklist

- [ ] All pipeline stages implemented as described, typecheck clean.
- [ ] Sources file seeded with verified, currently-working feeds across all three tiers.
- [ ] A real local run produces a sensible `digests/YYYY-MM-DD.md`.
- [ ] Email verified locally against a real Gmail app password.
- [ ] Weekly GitHub Actions workflow committing digests and dedup state.
- [ ] A README documenting setup, the env vars, and how to add a source.
- [ ] This CLAUDE.md updated to reflect the real architecture once the code exists
      (replace this spec with concise guidance for future work).
