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
