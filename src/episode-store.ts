import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildFeed } from "./feed.js";
import type { Episode } from "./types.js";

export const EPISODES_PATH = "state/episodes.json";
export const SITE_DIR = "site";
const COVER_SOURCE = "assets/cover.jpg";

export async function loadEpisodes(path = EPISODES_PATH): Promise<Episode[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed) ? (parsed as Episode[]) : [];
  } catch {
    return []; // first run, or unreadable — start clean, same as loadSeen
  }
}

export async function saveEpisodes(episodes: Episode[], path = EPISODES_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(episodes, null, 2)}\n`, "utf8");
}

/** Replace by date rather than append, so a re-run can never emit a duplicate guid. */
export function upsertEpisode(episodes: Episode[], episode: Episode): Episode[] {
  const index = episodes.findIndex((e) => e.date === episode.date);
  if (index === -1) return [...episodes, episode];
  const copy = [...episodes];
  copy[index] = episode;
  return copy;
}

/**
 * Runs on every digest, outside the best-effort podcast block. If it only ran
 * inside, every skip path would leave site/ absent, upload-pages-artifact would
 * fail, and a healthy digest run would report as a red workflow.
 */
export async function writeSite(episodes: Episode[], dir = SITE_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "feed.xml"), buildFeed(episodes), "utf8");
  try {
    await copyFile(COVER_SOURCE, join(dir, "cover.jpg"));
  } catch {
    console.warn(`[site] no ${COVER_SOURCE} to copy — the feed will reference a missing image`);
  }
  console.log(`[site] wrote ${dir}/feed.xml with ${episodes.length} episode(s)`);
}
