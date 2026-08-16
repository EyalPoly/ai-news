import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEpisodes, saveEpisodes, upsertEpisode, writeSite } from "./episode-store.js";
import type { Episode } from "./types.js";

function episode(p: Partial<Episode> = {}): Episode {
  return {
    date: p.date ?? "2026-08-03",
    title: p.title ?? "Title",
    summary: p.summary ?? "Summary",
    items: p.items ?? [{ title: "I", link: "https://x/1", source: "S" }],
    audioUrl: p.audioUrl ?? "https://x/a.mp3",
    bytes: p.bytes ?? 100,
    durationSec: p.durationSec ?? 600,
  };
}

test("loadEpisodes returns an empty list when the manifest does not exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eps-"));
  assert.deepEqual(await loadEpisodes(join(dir, "episodes.json")), []);
});

test("loadEpisodes returns an empty list for unreadable JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eps-"));
  const path = join(dir, "episodes.json");
  await writeFile(path, "{not json", "utf8");
  assert.deepEqual(await loadEpisodes(path), []);
});

test("saveEpisodes then loadEpisodes round-trips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eps-"));
  const path = join(dir, "episodes.json");
  await saveEpisodes([episode()], path);
  assert.deepEqual(await loadEpisodes(path), [episode()]);
});

test("upsertEpisode appends a new date", () => {
  const result = upsertEpisode([episode({ date: "2026-08-03" })], episode({ date: "2026-08-10" }));
  assert.deepEqual(result.map((e) => e.date), ["2026-08-03", "2026-08-10"]);
});

test("upsertEpisode replaces an existing date rather than duplicating the guid", () => {
  const result = upsertEpisode(
    [episode({ date: "2026-08-03", title: "Old" })],
    episode({ date: "2026-08-03", title: "New" }),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.title, "New");
});

test("writeSite emits feed.xml", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site-"));
  await writeSite([episode()], dir);
  const xml = await readFile(join(dir, "feed.xml"), "utf8");
  assert.match(xml, /<rss version="2\.0"/);
  assert.match(xml, /<item>/);
});

test("writeSite emits a valid feed for an empty manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site-"));
  await writeSite([], dir);
  const xml = await readFile(join(dir, "feed.xml"), "utf8");
  assert.match(xml, /<channel>/);
  assert.doesNotMatch(xml, /<item>/);
});
