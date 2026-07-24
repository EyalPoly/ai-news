import Anthropic from "@anthropic-ai/sdk";
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
import type { Category, FeedItem, Score, ScoredItem, Tier } from "./types.js";

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

function clampRelevance(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function safeCategory(value: unknown): Category {
  return CATEGORIES.includes(value as Category) ? (value as Category) : "ecosystem";
}

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
    const s = scores[i] ?? { relevance: 0, category: "ecosystem" as Category };
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
