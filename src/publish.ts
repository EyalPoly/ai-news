import { writeFile } from "node:fs/promises";

const API = "https://api.github.com";
const UPLOADS = "https://uploads.github.com";

/**
 * Release assets rather than committed files: on a public repo they have direct
 * download URLs needing no auth, and they count against neither repo size nor
 * the Pages site limit. Returns the public URL, or null when there is no token
 * (local runs), in which case the MP3 lands on disk so the pipeline stays
 * exercisable without releasing.
 */
export async function publishEpisode(
  date: string,
  mp3: Buffer,
  title: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const filename = `episode-${date}.mp3`;

  if (!token || !repo) {
    await writeFile(filename, mp3);
    console.log(`[publish] GITHUB_TOKEN/GITHUB_REPOSITORY unset — wrote ${filename}`);
    return null;
  }

  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };

  const created = await fetchImpl(`${API}/repos/${repo}/releases`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      tag_name: `episode-${date}`,
      name: title,
      body: `Podcast episode for ${date}.`,
    }),
  });
  if (!created.ok) {
    throw new Error(`[publish] release creation failed: ${created.status} ${await created.text()}`);
  }
  const { id } = (await created.json()) as { id: number };

  // GitHub serves back whatever content type the asset was uploaded with, and
  // the default octet-stream is a known cause of podcast ingesters rejecting
  // the enclosure. This must match <enclosure type>.
  const uploaded = await fetchImpl(
    `${UPLOADS}/repos/${repo}/releases/${id}/assets?name=${encodeURIComponent(filename)}`,
    { method: "POST", headers: { ...headers, "content-type": "audio/mpeg" }, body: new Uint8Array(mp3) },
  );
  if (!uploaded.ok) {
    throw new Error(`[publish] asset upload failed: ${uploaded.status} ${await uploaded.text()}`);
  }

  const { browser_download_url: url } = (await uploaded.json()) as { browser_download_url: string };
  console.log(`[publish] uploaded ${filename} → ${url}`);
  return url;
}
