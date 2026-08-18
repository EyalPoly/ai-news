import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import NodeID3 from "node-id3";
import { runPodcast } from "./podcast.js";
import type { Episode } from "./types.js";

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

const ARTICLE_HTML = `<!doctype html><html><head><title>A Real Post</title></head><body>
  <nav><a href="/">Home</a></nav>
  <article><h1>A Real Post</h1>
    ${"<p>This is a substantial paragraph of article body text that readability should keep.</p>".repeat(12)}
  </article></body></html>`;

const DIGEST = [
  "# AI/Agents Digest — 2026-08-03",
  "",
  "## Engineering",
  "",
  "- [One](https://a.test/one)",
  "  *Latent Space · relevance 9/10*",
  "- [Two](https://b.test/two)",
  "  *Simon Willison · relevance 9/10*",
  "- [Three](https://c.test/three)",
  "  *Lilian Weng · relevance 9/10*",
  "",
].join("\n");

/** 120 words per segment clears validateScript's 110-300 band, so no retry fires. */
function line(word: string): string {
  return Array.from({ length: 60 }, () => word).join(" ");
}

const SCRIPT = [
  "TITLE: Agents Get Practical",
  "SUMMARY: Three stories about building with agents this week.",
  "[[ITEM 1]]",
  `Maya: ${line("alpha")}`,
  `Daniel: ${line("beta")}`,
  "[[ITEM 2]]",
  `Maya: ${line("gamma")}`,
  `Daniel: ${line("delta")}`,
  "[[ITEM 3]]",
  `Maya: ${line("epsilon")}`,
  `Daniel: ${line("zeta")}`,
].join("\n");

/** Two seconds of 24kHz mono s16 PCM — enough for a real MP3 encode, small enough to stay fast. */
const PCM = Buffer.alloc(96_000);
const AUDIO_URL =
  "https://github.com/o/r/releases/download/episode-2026-08-03/episode-2026-08-03.mp3";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Restores exactly the keys it set, so it cannot leak into the other tests. */
function setEnv(vars: Record<string, string>): () => void {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, vars);
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("runPodcast composes extract → script → synthesis → publish into an Episode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pod-"));
  await writeFile(join(dir, "2026-08-03.md"), DIGEST, "utf8");

  const stages: string[] = [];
  let uploadedMp3: Buffer | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);

    if (url.includes("generativelanguage")) {
      const body = JSON.parse(String(init?.body)) as {
        generationConfig?: { responseModalities?: string[] };
      };
      if (body.generationConfig?.responseModalities) {
        stages.push("tts");
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "audio/L16", data: PCM.toString("base64") } }],
              },
            },
          ],
        });
      }
      stages.push("script");
      return jsonResponse({ candidates: [{ content: { parts: [{ text: SCRIPT }] } }] });
    }

    if (url.startsWith("https://api.github.com")) {
      stages.push("release");
      return jsonResponse({ id: 42 });
    }
    if (url.startsWith("https://uploads.github.com")) {
      stages.push("upload");
      uploadedMp3 = Buffer.from(init?.body as Uint8Array);
      return jsonResponse({ browser_download_url: AUDIO_URL });
    }

    stages.push(`extract:${url}`);
    return new Response(ARTICLE_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };

  // The episode manifest and publish fallback are cwd-relative, so run the whole
  // thing inside the temp dir rather than writing state/ into the repo.
  const cwd = process.cwd();
  const restoreEnv = setEnv({
    GEMINI_API_KEY: "k",
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "o/r",
  });
  process.chdir(dir);

  let episode: Episode | null;
  let manifest: Episode[];
  try {
    episode = await runPodcast("2026-08-03", dir, fetchImpl);
    manifest = JSON.parse(await readFile("state/episodes.json", "utf8")) as Episode[];
  } finally {
    process.chdir(cwd);
    restoreEnv();
  }

  assert.ok(episode, "expected an episode");
  assert.equal(episode.date, "2026-08-03");
  assert.equal(episode.title, "Agents Get Practical");
  assert.equal(episode.summary, "Three stories about building with agents this week.");
  // Compared sorted: show-note order follows select.ts's rank-then-id ranking,
  // not digest order, and that ranking has its own tests.
  assert.deepEqual(
    episode.items.map((i) => [i.title, i.link, i.source]).sort(),
    [
      ["One", "https://a.test/one", "Latent Space"],
      ["Three", "https://c.test/three", "Lilian Weng"],
      ["Two", "https://b.test/two", "Simon Willison"],
    ],
  );
  assert.equal(episode.audioUrl, AUDIO_URL);
  assert.equal(episode.durationSec, 2);
  assert.ok(episode.bytes > 1000, `expected a real MP3, got ${episode.bytes} bytes`);

  // Every stage ran exactly once through the injected fetch: three articles
  // extracted, one script call (no corrective retry), one TTS chunk, one release.
  assert.deepEqual(stages.filter((s) => s.startsWith("extract:")).length, 3);
  assert.deepEqual(
    stages.filter((s) => !s.startsWith("extract:")),
    ["script", "tts", "release", "upload"],
  );

  assert.deepEqual(manifest, [episode]);

  const read = NodeID3.read(uploadedMp3 as Buffer);
  assert.equal(read.chapter?.length, 3, "expected one chapter per published item");
  assert.deepEqual(
    read.chapter?.map((c) => c.tags?.title),
    episode.items.map((i) => i.title),
  );
});

test("runPodcast skips an already-published date before doing any work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pod-"));
  await writeFile(join(dir, "2026-08-03.md"), DIGEST, "utf8");
  await mkdir(join(dir, "state"), { recursive: true });
  await writeFile(
    join(dir, "state", "episodes.json"),
    JSON.stringify([{ date: "2026-08-03", title: "Already Out" }]),
    "utf8",
  );

  const cwd = process.cwd();
  const restoreEnv = setEnv({ GEMINI_API_KEY: "k" });
  process.chdir(dir);

  let result: Episode | null;
  let calls = 0;
  try {
    result = await runPodcast("2026-08-03", dir, async () => {
      calls++;
      return new Response("should never be fetched", { status: 500 });
    });
  } finally {
    process.chdir(cwd);
    restoreEnv();
  }

  assert.equal(result, null);
  assert.equal(calls, 0, "no stage may run once the date is already published");
});
