import { digestPath, writeDigest } from "./digest-store.js";
import { RELEVANCE_THRESHOLD } from "./config.js";
import { fetchAll } from "./fetch.js";
import { filterNew, loadSeen, prune, recordSeen, saveSeen } from "./seen-store.js";
import { scoreItems } from "./score.js";
import { renderDigest } from "./render.js";
import { sendDigest } from "./email.js";
import { loadEpisodes, writeSite } from "./episode-store.js";
import { runPodcast } from "./podcast.js";

/** YYYY-MM-DD in UTC, so digest filenames are stable regardless of runner timezone. */
function isoDate(now: Date): string {
  const part = now.toISOString().slice(0, 10);
  return part;
}

async function main(): Promise<void> {
  const now = Date.now();
  const date = isoDate(new Date(now));

  const fetched = await fetchAll(now);
  console.log(`[digest] fetched ${fetched.length} items in window`);

  const seen = await loadSeen();
  const fresh = filterNew(fetched, seen);
  console.log(`[digest] ${fresh.length} new after dedup against seen-store`);

  const scored = await scoreItems(fresh);

  const markdown = renderDigest(scored, date);
  const keptCount = scored.filter((i) => i.relevance >= RELEVANCE_THRESHOLD).length;
  const wrote = await writeDigest(date, markdown, keptCount);
  console.log(
    wrote
      ? `[digest] wrote ${digestPath(date)}`
      : `[digest] kept existing ${digestPath(date)} (re-run found no new items)`,
  );

  // Persist dedup state *before* email — email must never block committing results.
  recordSeen(fresh, seen, now);
  await saveSeen(prune(seen, now));
  console.log("[digest] saved seen-store");

  const episode = await runPodcast(date);

  // Outside the best-effort podcast block on purpose: site/ must exist on every
  // run or the Pages upload fails and a healthy digest reports as a red workflow.
  // Still guarded, because a filesystem failure here must not cost the email.
  try {
    await writeSite(await loadEpisodes());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[digest] site generation failed (continuing): ${reason}`);
  }

  await sendDigest(
    `AI/Agents Digest — ${date}`,
    markdown,
    episode?.audioUrl,
    episode?.durationSec,
  );
}

main().catch((err) => {
  console.error("[digest] fatal:", err);
  process.exit(1);
});
