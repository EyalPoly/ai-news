import { test } from "node:test";
import assert from "node:assert/strict";
import { rm, readFile } from "node:fs/promises";
import { publishEpisode } from "./publish.js";

const ASSET_URL =
  "https://github.com/EyalPoly/ai-news/releases/download/episode-2026-08-03/episode-2026-08-03.mp3";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  return fn().finally(() => {
    process.env = saved;
  });
}

test("publishEpisode creates a release then uploads the asset as audio/mpeg", async () => {
  const seen: { url: string; method: string; contentType: string | null }[] = [];

  const url = await withEnv(
    { GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "EyalPoly/ai-news" },
    () =>
      publishEpisode("2026-08-03", Buffer.from("audio"), "Opus 5 lands", async (input, init) => {
        seen.push({
          url: String(input),
          method: init?.method ?? "GET",
          contentType: new Headers(init?.headers).get("content-type"),
        });
        return seen.length === 1
          ? jsonResponse({ id: 42 }, 201)
          : jsonResponse({ browser_download_url: ASSET_URL }, 201);
      }),
  );

  assert.equal(url, ASSET_URL);
  assert.equal(seen.length, 2);
  assert.match(seen[0]!.url, /api\.github\.com\/repos\/EyalPoly\/ai-news\/releases$/);
  assert.equal(seen[0]!.method, "POST");
  assert.match(seen[1]!.url, /uploads\.github\.com\/repos\/EyalPoly\/ai-news\/releases\/42\/assets\?name=episode-2026-08-03\.mp3$/);
  assert.equal(seen[1]!.contentType, "audio/mpeg", "wrong content type makes ingesters reject the enclosure");
});

test("publishEpisode writes to disk and returns null without GITHUB_TOKEN", async () => {
  const url = await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
    const result = await publishEpisode("2026-08-03", Buffer.from("audio"), "t", async () => {
      throw new Error("must not call the network");
    });
    assert.equal(await readFile("episode-2026-08-03.mp3", "utf8"), "audio");
    await rm("episode-2026-08-03.mp3", { force: true });
    return result;
  });
  assert.equal(url, null);
});

test("publishEpisode throws when release creation fails", async () => {
  await withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r" }, async () => {
    await assert.rejects(
      publishEpisode("2026-08-03", Buffer.from("a"), "t", async () =>
        jsonResponse({ message: "tag exists" }, 422),
      ),
      /422/,
    );
  });
});

test("publishEpisode throws when the asset upload fails", async () => {
  let call = 0;
  await withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r" }, async () => {
    await assert.rejects(
      publishEpisode("2026-08-03", Buffer.from("a"), "t", async () => {
        call++;
        return call === 1 ? jsonResponse({ id: 1 }, 201) : jsonResponse({ message: "nope" }, 500);
      }),
      /500/,
    );
  });
});
