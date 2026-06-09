import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SEEN_PRUNE_DAYS } from "./config.js";
import type { FeedItem } from "./types.js";

export type { FeedItem } from "./types.js";

/** item id → first-seen epoch ms. */
export type SeenStore = Record<string, number>;

export const SEEN_PATH = "state/seen.json";

export async function loadSeen(path = SEEN_PATH): Promise<SeenStore> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SeenStore) : {};
  } catch {
    return {}; // first run, or unreadable — start clean
  }
}

export async function saveSeen(store: SeenStore, path = SEEN_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/** Items whose id is not yet in the store. */
export function filterNew(items: FeedItem[], store: SeenStore): FeedItem[] {
  return items.filter((i) => !(i.id in store));
}

/** Record ids at `now`, without overwriting an earlier first-seen timestamp. */
export function recordSeen(items: FeedItem[], store: SeenStore, now = Date.now()): void {
  for (const i of items) {
    if (!(i.id in store)) store[i.id] = now;
  }
}

/** Return a copy with entries older than SEEN_PRUNE_DAYS removed. */
export function prune(store: SeenStore, now = Date.now()): SeenStore {
  const cutoff = now - SEEN_PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const out: SeenStore = {};
  for (const [id, ts] of Object.entries(store)) {
    if (ts >= cutoff) out[id] = ts;
  }
  return out;
}
