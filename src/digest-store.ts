import { mkdir, readFile, writeFile } from "node:fs/promises";

export const DIGEST_DIR = "digests";

export function digestPath(date: string, dir = DIGEST_DIR): string {
  return `${dir}/${date}.md`;
}

/** The committed digest for a date, or null if there isn't one. */
export async function readDigest(date: string, dir = DIGEST_DIR): Promise<string | null> {
  try {
    return await readFile(digestPath(date, dir), "utf8");
  } catch {
    return null;
  }
}

/**
 * Write the digest unless doing so would replace a real one with the empty
 * placeholder. A same-day re-run finds every item already in the seen-store,
 * so `scored` is empty and `renderDigest` emits the placeholder; without this
 * guard that placeholder overwrites the good digest and the workflow commits
 * the destruction. Returns whether anything was written.
 */
export async function writeDigest(
  date: string,
  markdown: string,
  itemCount: number,
  dir = DIGEST_DIR,
): Promise<boolean> {
  if (itemCount === 0 && (await readDigest(date, dir)) !== null) return false;
  await mkdir(dir, { recursive: true });
  await writeFile(digestPath(date, dir), markdown, "utf8");
  return true;
}
