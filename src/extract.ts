import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import {
  EXTRACT_MAX_BYTES,
  EXTRACT_MAX_CHARS,
  EXTRACT_MIN_CHARS,
  EXTRACT_TIMEOUT_MS,
  EXTRACT_USER_AGENT,
} from "./config.js";
import type { ExtractedItem, ScoredItem } from "./types.js";

export interface ExtractResult {
  text: string | null;
  /** Categorized reason, for logs. Extraction rate is what determines episode quality. */
  failure?: string;
}

/**
 * Circuit breaker for readableText. Readability's parse cost is super-quadratic
 * in DOM nesting depth, so a page far below EXTRACT_MAX_BYTES can still occupy
 * the event loop for minutes — and parse() is synchronous, so AbortSignal covers
 * the fetch but not this. A hang here would block the digest email and the Pages
 * site for the week, so the ceiling sits well above any real article (a long post
 * is a few thousand elements) and comfortably below where the cost explodes.
 */
const MAX_DOM_ELEMENTS = 10_000;

export function readableText(html: string): string | null {
  const { document } = parseHTML(html);

  // querySelectorAll, not getElementsByTagName("*"): linkedom returns an empty
  // list for the wildcard tag name, which would silently disable the guard.
  const elements = document.querySelectorAll("*").length;
  if (elements > MAX_DOM_ELEMENTS) {
    console.warn(`[extract] ${elements} DOM elements exceeds the ${MAX_DOM_ELEMENTS} ceiling`);
    return null;
  }

  try {
    const article = new Readability(document as any).parse();
    const text = (article?.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.length > 0 ? text : null;
  } catch {
    // Readability throws (not returns null) on a document it cannot use at all:
    // an empty body, or JSON mislabeled text/html. One bad page must cost one
    // item — the caller maps null to "unparseable" — never the whole episode.
    return null;
  }
}

export async function extractArticle(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { "user-agent": EXTRACT_USER_AGENT },
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : String(err);
    return { text: null, failure: name === "TimeoutError" ? "timeout" : `fetch:${name}` };
  }

  if (!response.ok) return { text: null, failure: `http-${response.status}` };

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    const bare = contentType.split(";")[0]?.trim() || "unknown";
    return { text: null, failure: `content-type:${bare}` };
  }

  // Only a pre-check: servers may omit content-length, so the body is capped again below.
  if (Number(response.headers.get("content-length") ?? "0") > EXTRACT_MAX_BYTES) {
    return { text: null, failure: "too-large" };
  }

  const html = await response.text();
  if (html.length > EXTRACT_MAX_BYTES) return { text: null, failure: "too-large" };

  const text = readableText(html);
  if (text === null) return { text: null, failure: "unparseable" };
  if (text.length < EXTRACT_MIN_CHARS) return { text: null, failure: `too-short:${text.length}` };

  return { text: text.slice(0, EXTRACT_MAX_CHARS) };
}

/** Parallel — these hit unrelated hosts and have no shared rate limit to respect. */
export async function extractAll(
  items: ScoredItem[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractedItem[]> {
  return Promise.all(
    items.map(async (item): Promise<ExtractedItem> => {
      // Defense in depth: a rejection here would take the whole batch — and so
      // the episode — down with it, however the throw got past extractArticle.
      try {
        const { text, failure } = await extractArticle(item.link, fetchImpl);
        if (failure) console.warn(`[extract] ${failure} — ${item.link} (${item.source})`);
        return { ...item, text, failure };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[extract] extract-error — ${item.link} (${item.source}): ${reason}`);
        return { ...item, text: null, failure: "extract-error" };
      }
    }),
  );
}
