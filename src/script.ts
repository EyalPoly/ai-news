import {
  PODCAST_INTRO_OUTRO_WORDS,
  PODCAST_MAX_WORDS_PER_ITEM,
  PODCAST_MIN_WORDS_PER_ITEM,
  PODCAST_SCRIPT_MODEL,
  PODCAST_SPEAKERS,
  PODCAST_TARGET_MINUTES,
  SPEECH_WPM,
} from "./config.js";
import { generateText } from "./gemini.js";
import { withRetry } from "./retry.js";
import type { ExtractedItem, ParsedScript, Segment, Turn } from "./types.js";

const SPEAKER_NAMES = PODCAST_SPEAKERS.map((s) => s.name);
const SPEAKER_RE = new RegExp(`^(${SPEAKER_NAMES.join("|")}):\\s*(.+)$`);
const MARKER_RE = /^\[\[ITEM (\d+)\]\]$/;
const TITLE_RE = /^TITLE:\s*(.+)$/;
const SUMMARY_RE = /^SUMMARY:\s*(.+)$/;

const TOTAL_WORD_BUDGET = PODCAST_TARGET_MINUTES * SPEECH_WPM;
const MAX_TITLE_CHARS = 100;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function segmentWords(segment: Segment): number {
  return segment.turns.reduce((sum, turn) => sum + wordCount(turn.text), 0);
}

/**
 * The prompt forbids all of these, but asking is not enough — TTS reads every
 * one of them aloud verbatim, and the URL case is both the worst-sounding and
 * the most likely, because the prompt hands the model item links.
 */
export function sanitizeSpokenText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[([][^)\]]*[)\]]/g, "")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildScriptPrompt(items: ExtractedItem[], date: string): string {
  const [first, second] = SPEAKER_NAMES;
  const itemBlocks = items.map((item, i) =>
    [
      `[[ITEM ${i + 1}]]`,
      `Title: ${item.title}`,
      `Source: ${item.source}`,
      `Article text: ${item.text ?? ""}`,
    ].join("\n"),
  );

  return [
    `You write a weekly podcast for a senior software engineer who builds LLM-powered`,
    `systems and agent tooling. Reward hands-on, buildable signal. Discount hype,`,
    `funding-only news, and consumer fluff.`,
    "",
    `Write a two-host dialogue for the episode dated ${date}. The hosts are`,
    `${first} and ${second}.`,
    "",
    "OUTPUT FORMAT — follow exactly, no deviation:",
    "",
    "TITLE: <episode title, one line, at most 100 characters>",
    "SUMMARY: <1-2 sentences describing the episode>",
    `[[ITEM 1]]`,
    `${first}: <spoken line>`,
    `${second}: <spoken line>`,
    `[[ITEM 2]]`,
    `${first}: <spoken line>`,
    "",
    "RULES:",
    `- Emit exactly one [[ITEM n]] marker per supplied item, in the order given.`,
    `- Every spoken line begins with "${first}: " or "${second}: ". Nothing else.`,
    `- Budget about ${TOTAL_WORD_BUDGET} words total, including roughly`,
    `  ${PODCAST_INTRO_OUTRO_WORDS} words of intro and outro.`,
    `- Spend between ${PODCAST_MIN_WORDS_PER_ITEM} and ${PODCAST_MAX_WORDS_PER_ITEM} words`,
    `  per story. Go long where there is real substance to explain; keep thin items`,
    `  to a couple of sentences. Do not pad.`,
    `- Open by naming the show and the week of ${date}; close with a short signoff.`,
    `  Put the intro inside [[ITEM 1]] and the outro inside the last item's segment.`,
    `- Discuss what is actually new and buildable. No hype.`,
    `- If two items cover the same announcement, merge them into one discussion and`,
    `  say so, rather than repeating yourself.`,
    `- NEVER read a URL aloud. Say "linked in the show notes" instead.`,
    `- No stage directions, no sound cues, no markdown, no parentheticals.`,
    "",
    "ITEMS:",
    "",
    itemBlocks.join("\n\n"),
  ].join("\n");
}

export function parseScript(raw: string, date: string): ParsedScript {
  let title = "";
  let summary = "";
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const line of raw.split("\n").map((l) => l.trim())) {
    if (line === "") continue;

    const marker = MARKER_RE.exec(line);
    if (marker) {
      current = { index: Number(marker[1]), turns: [] };
      segments.push(current);
      continue;
    }

    const titleMatch = TITLE_RE.exec(line);
    if (titleMatch && title === "") {
      title = (titleMatch[1] as string).trim();
      continue;
    }

    const summaryMatch = SUMMARY_RE.exec(line);
    if (summaryMatch && summary === "") {
      summary = (summaryMatch[1] as string).trim();
      continue;
    }

    const speakerMatch = SPEAKER_RE.exec(line);
    if (!speakerMatch || !current) {
      console.warn(`[script] dropping unrecognized line: ${line.slice(0, 80)}`);
      continue;
    }

    const text = sanitizeSpokenText(speakerMatch[2] as string);
    if (text !== "") {
      const turn: Turn = { speaker: speakerMatch[1] as string, text };
      current.turns.push(turn);
    }
  }

  if (segments.length === 0) throw new Error("script response contained no segments");

  const usableTitle = title !== "" && title.length <= MAX_TITLE_CHARS;
  return {
    title: usableTitle ? title : `AI/Agents Digest — ${date}`,
    summary,
    segments: segments.filter((s) => s.turns.length > 0),
  };
}

/** Returns human-readable violations; empty means the script is acceptable. */
export function validateScript(script: ParsedScript, itemCount: number): string[] {
  const violations: string[] = [];

  for (let n = 1; n <= itemCount; n++) {
    if (!script.segments.some((s) => s.index === n)) {
      violations.push(`missing [[ITEM ${n}]] — every supplied item needs its own segment`);
    }
  }

  for (const segment of script.segments) {
    const words = segmentWords(segment);
    if (words < PODCAST_MIN_WORDS_PER_ITEM) {
      violations.push(
        `segment ${segment.index} is ${words} words; the minimum is ${PODCAST_MIN_WORDS_PER_ITEM}`,
      );
    } else if (words > PODCAST_MAX_WORDS_PER_ITEM) {
      violations.push(
        `segment ${segment.index} is ${words} words; the maximum is ${PODCAST_MAX_WORDS_PER_ITEM}`,
      );
    }
  }

  return violations;
}

/**
 * One call, one corrective retry. Models systematically undershoot long-output
 * targets, so the retry is expected to fire. After it, accept with a warning —
 * the block is best-effort and a slightly-off episode beats no episode.
 */
export async function generateScript(
  items: ExtractedItem[],
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedScript> {
  const prompt = buildScriptPrompt(items, date);

  const first = parseScript(
    await withRetry(() => generateText(PODCAST_SCRIPT_MODEL, prompt, fetchImpl)),
    date,
  );
  const violations = validateScript(first, items.length);
  if (violations.length === 0) return first;

  console.warn(`[script] retrying — ${violations.length} violation(s): ${violations.join("; ")}`);

  const corrective = [
    prompt,
    "",
    "Your previous attempt had these problems. Fix all of them and re-emit the",
    "entire script in the same format:",
    ...violations.map((v) => `- ${v}`),
  ].join("\n");

  const second = parseScript(
    await withRetry(() => generateText(PODCAST_SCRIPT_MODEL, corrective, fetchImpl)),
    date,
  );
  const remaining = validateScript(second, items.length);
  if (remaining.length > 0) {
    console.warn(`[script] accepting with violations: ${remaining.join("; ")}`);
  }
  return second;
}
