import { GEMINI_API_KEY, PODCAST_MIN_ITEMS } from "./config.js";
import { DIGEST_DIR, readDigest } from "./digest-store.js";
import { parseDigest } from "./digest-parse.js";
import { loadEpisodes, saveEpisodes, upsertEpisode } from "./episode-store.js";
import { extractAll } from "./extract.js";
import { publishEpisode } from "./publish.js";
import { generateScript } from "./script.js";
import { candidatePool, pickEpisodeItems } from "./select.js";
import { synthesizeEpisode } from "./tts.js";
import type { Episode } from "./types.js";

async function buildEpisode(date: string, dir: string): Promise<Episode | null> {
  const markdown = await readDigest(date, dir);
  if (markdown === null) {
    console.warn(`[podcast] no digest for ${date} — skipping`);
    return null;
  }

  const items = parseDigest(markdown);
  const pool = candidatePool(items);
  if (pool.length === 0) {
    console.log("[podcast] digest has no items — skipping");
    return null;
  }

  const extracted = await extractAll(pool);
  const picked = pickEpisodeItems(extracted);
  const usable = extracted.filter((i) => i.text !== null).length;
  console.log(`[podcast] extracted ${usable}/${pool.length}, covering ${picked.length}`);

  if (picked.length < PODCAST_MIN_ITEMS) {
    console.warn(`[podcast] only ${picked.length} extractable items — skipping`);
    return null;
  }

  const script = await generateScript(picked, date);
  const { mp3, durationSec } = await synthesizeEpisode(script);

  const audioUrl = await publishEpisode(date, mp3, script.title);
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
    bytes: mp3.length,
    durationSec,
  };

  await saveEpisodes(upsertEpisode(await loadEpisodes(), episode));
  return episode;
}

/**
 * Best-effort, mirroring sendDigest: never throws, so the committed digest and
 * the email are never blocked. Partial episodes are never published — a run
 * produces a complete episode or none.
 */
export async function runPodcast(date: string, dir = DIGEST_DIR): Promise<Episode | null> {
  if (!GEMINI_API_KEY) {
    console.log("[podcast] GEMINI_API_KEY unset — skipping");
    return null;
  }
  try {
    return await buildEpisode(date, dir);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[podcast] failed (continuing): ${reason}`);
    return null;
  }
}
