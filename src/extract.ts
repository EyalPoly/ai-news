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

export function readableText(html: string): string | null {
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as Document).parse();
  const text = (article?.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
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
      const { text, failure } = await extractArticle(item.link, fetchImpl);
      if (failure) console.warn(`[extract] ${failure} — ${item.link} (${item.source})`);
      return { ...item, text, failure };
    }),
  );
}
