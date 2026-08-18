import { PODCAST_MIN_ITEMS } from "./config.js";
import { computeChapters } from "./chapters.js";
import { DIGEST_DIR, readDigest } from "./digest-store.js";
import { parseDigest } from "./digest-parse.js";
import { loadEpisodes, saveEpisodes, upsertEpisode } from "./episode-store.js";
import { extractAll } from "./extract.js";
import { embedChapters } from "./id3.js";
import { publishEpisode } from "./publish.js";
import { generateScript } from "./script.js";
import { candidatePool, pickEpisodeItems } from "./select.js";
import { synthesizeEpisode } from "./tts.js";
import type { Episode } from "./types.js";

async function buildEpisode(
  date: string,
  dir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Episode | null> {
  const markdown = await readDigest(date, dir);
  if (markdown === null) {
    console.warn(`[podcast] no digest for ${date} — skipping`);
    return null;
  }

  // Before any work: a re-run for an already-published date would re-extract,
  // re-script and burn the whole free-tier TTS quota only to hit 422 on the
  // existing episode-<date> release tag.
  const published = await loadEpisodes();
  if (published.some((e) => e.date === date)) {
    console.log(`[podcast] episode for ${date} already published — skipping`);
    return null;
  }

  const items = parseDigest(markdown);
  const pool = candidatePool(items);
  if (pool.length === 0) {
    console.log("[podcast] digest has no items — skipping");
    return null;
  }

  const extracted = await extractAll(pool, fetchImpl);
  const picked = pickEpisodeItems(extracted);
  const usable = extracted.filter((i) => i.text !== null).length;
  console.log(`[podcast] extracted ${usable}/${pool.length}, covering ${picked.length}`);

  if (picked.length < PODCAST_MIN_ITEMS) {
    console.warn(`[podcast] only ${picked.length} extractable items — skipping`);
    return null;
  }

  const script = await generateScript(picked, date, fetchImpl);
  const { mp3, durationSec } = await synthesizeEpisode(script, fetchImpl);

  const chapters = computeChapters(script, picked, durationSec);
  const tagged = embedChapters(mp3, chapters);

  const audioUrl = await publishEpisode(date, tagged, script.title, fetchImpl);
  if (audioUrl === null) {
    console.log("[podcast] not published (no token) — manifest unchanged");
    return null;
  }

  const episode: Episode = {
    date,
    title: script.title,
    summary: script.summary,
    items: picked.map((i) => ({ title: i.title, link: i.link, source: i.source })),
    audioUrl,
    bytes: tagged.length,
    durationSec,
  };

  await saveEpisodes(upsertEpisode(published, episode));
  return episode;
}

/**
 * Best-effort, mirroring sendDigest: never throws, so the committed digest and
 * the email are never blocked. Partial episodes are never published — a run
 * produces a complete episode or none.
 */
export async function runPodcast(
  date: string,
  dir = DIGEST_DIR,
  fetchImpl: typeof fetch = fetch,
): Promise<Episode | null> {
  if (!process.env.GEMINI_API_KEY) {
    console.log("[podcast] GEMINI_API_KEY unset — skipping");
    return null;
  }
  try {
    return await buildEpisode(date, dir, fetchImpl);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[podcast] failed (continuing): ${reason}`);
    return null;
  }
}
