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

/** Public base URL of the GitHub Pages site that serves feed.xml and the cover art. */
export const SITE_BASE_URL = process.env.SITE_BASE_URL ?? "https://eyalpoly.github.io/ai-news";

export const PODCAST_TITLE = "AI/Agents Weekly";
export const PODCAST_DESCRIPTION =
  "A ten-minute weekly rundown of AI and agent news for people who build LLM-powered systems.";
export const PODCAST_AUTHOR = "Eyal Politansky";
/**
 * Published verbatim in a world-readable feed and indexed by every directory
 * that ingests it, so this is a `+`-tagged alias: same inbox, and it identifies
 * the leak source later. Fall back to the plain address if a directory rejects `+`.
 */
export const PODCAST_OWNER_EMAIL = process.env.PODCAST_OWNER_EMAIL ?? "10eyal10+podcast@gmail.com";
export const PODCAST_LANGUAGE = "en-us";
/** Apple's taxonomy is fixed; "Technology" has no subcategories. */
export const PODCAST_CATEGORY = "Technology";
export const PODCAST_EXPLICIT = false;

/** Items pulled from the digest for extraction. Oversized so failures can be backfilled. */
export const PODCAST_CANDIDATE_POOL = 20;

/** Items actually discussed in an episode. Bounds episode length independent of news volume. */
export const PODCAST_TOP_N = 8;

/**
 * Cap per feed. arXiv publishes ~40 items/week at relevance 7–8 and would
 * otherwise dominate every episode; without this, a real week filled six of
 * eight slots from one nine-way rank tie of arXiv abstracts.
 */
export const PODCAST_MAX_PER_SOURCE = 3;

/** Below this many extractable items, skip the episode rather than publish a stub. */
export const PODCAST_MIN_ITEMS = 3;

/** Per-article fetch budget. `fetch` has no timeout option — this drives AbortSignal.timeout. */
export const EXTRACT_TIMEOUT_MS = 15000;

/** Cap per item so one long post cannot dominate the script prompt. */
export const EXTRACT_MAX_CHARS = 6000;

/** A successful fetch is not usable text: readability returns nav cruft from JS-only pages. */
export const EXTRACT_MIN_CHARS = 400;

/** One pathological page must not hold megabytes of DOM across 20 concurrent fetches. */
export const EXTRACT_MAX_BYTES = 2_000_000;

/** Node's fetch sends nothing meaningful and a large share of publishers 403 it. */
export const EXTRACT_USER_AGENT = "ai-news-digest/1.0 (+https://github.com/EyalPoly/ai-news)";

/** Gates the entire podcast block, mirroring how sendDigest gates on GMAIL_*. */
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

/** Free-tier text model that writes the dialogue. Confirmed in Spike A. */
export const PODCAST_SCRIPT_MODEL = process.env.PODCAST_SCRIPT_MODEL ?? "gemini-3.5-flash-lite";

/**
 * Multi-speaker TTS model. Confirmed in Spike A (2026-08-15): returns real,
 * non-silent audio on the free tier. `gemini-2.5-flash-preview-tts` and
 * `gemini-2.5-pro-preview-tts` are available fallbacks if this preview model
 * is deprecated.
 */
export const PODCAST_TTS_MODEL = process.env.PODCAST_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";

/**
 * The two hosts. This one array is the source of truth for the script prompt,
 * the parser's recognized speaker prefixes, and multiSpeakerVoiceConfig — whose
 * `speaker` field must match the transcript label exactly. Voice names confirmed
 * in Spike A (2026-08-15) via a live multi-speaker generateContent call.
 */
export const PODCAST_SPEAKERS = [
  { name: "Maya", voice: "Kore" },
  { name: "Daniel", voice: "Puck" },
] as const;

export const PODCAST_TARGET_MINUTES = 10;

/**
 * Conversational TTS pace. Does double duty: it converts the episode target
 * into a word budget for the script prompt, and sizes TTS chunks. Safe because
 * the chunk target (180s) sits ~2.7x under the per-call cap, so even a 35%
 * estimation error costs nothing. Replace with a measured value once a few
 * episodes have logged `words / durationSec * 60`.
 */
export const SPEECH_WPM = 150;

export const PODCAST_MIN_WORDS_PER_ITEM = 110;
export const PODCAST_MAX_WORDS_PER_ITEM = 300;

/** Intro + outro, budgeted explicitly so they don't eat item time. */
export const PODCAST_INTRO_OUTRO_WORDS = 60;

/**
 * Gemini TTS returns headerless raw PCM: 24kHz, mono, 16-bit signed LE.
 * 24000 samples/s x 2 bytes = 48000. Every duration calculation derives from this.
 */
export const PCM_BYTES_PER_SECOND = 48_000;

/**
 * Target per synthesis call. Two limits force chunking: a per-call output-token
 * cap, and documented quality drift on long generations. Duration is unknowable
 * before synthesis, so this is compared against a words/SPEECH_WPM estimate.
 */
export const TTS_CHUNK_TARGET_SECONDS = 180;

/** Seams now land on topic changes, not mid-conversation handoffs: a beat, not a breath. */
export const TTS_SEAM_SILENCE_MS = 500;

export const MP3_BITRATE_KBPS = 128;
