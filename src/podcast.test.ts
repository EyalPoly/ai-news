import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPodcast } from "./podcast.js";

test("runPodcast returns null and does not throw when GEMINI_API_KEY is unset", async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.equal(await runPodcast("2026-08-03"), null);
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("runPodcast returns null when the digest for the date is missing", async () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "k";
  try {
    assert.equal(await runPodcast("1999-01-01"), null);
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  }
});

test("runPodcast returns null for a digest with no parsable items", async () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "k";
  const dir = await mkdtemp(join(tmpdir(), "pod-"));
  await writeFile(join(dir, "2026-08-03.md"), "# AI/Agents Digest — 2026-08-03\n", "utf8");
  try {
    assert.equal(await runPodcast("2026-08-03", dir), null);
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  }
});

test("runPodcast never throws when a stage fails", async () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "k";
  const dir = await mkdtemp(join(tmpdir(), "pod-"));
  // Three real items clear PODCAST_MIN_ITEMS at parse time, so the run proceeds
  // into extraction — which hits unreachable hosts and must be swallowed, not thrown.
  await writeFile(
    join(dir, "2026-08-03.md"),
    [
      "# AI/Agents Digest — 2026-08-03",
      "",
      "## Engineering",
      "",
      "- [One](https://127.0.0.1:9/a)",
      "  *Latent Space · relevance 9/10*",
      "- [Two](https://127.0.0.1:9/b)",
      "  *Simon Willison · relevance 9/10*",
      "- [Three](https://127.0.0.1:9/c)",
      "  *Lilian Weng · relevance 9/10*",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    assert.equal(await runPodcast("2026-08-03", dir), null);
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  }
});
