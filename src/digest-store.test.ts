import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestPath, readDigest, writeDigest } from "./digest-store.js";

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "digest-store-"));
}

test("digestPath builds the dated markdown path", () => {
  assert.equal(digestPath("2026-08-03", "digests"), "digests/2026-08-03.md");
});

test("readDigest returns null when the digest does not exist", async () => {
  const dir = await scratch();
  assert.equal(await readDigest("2026-08-03", dir), null);
});

test("writeDigest writes when there are items", async () => {
  const dir = await scratch();
  const wrote = await writeDigest("2026-08-03", "# real digest\n", 5, dir);
  assert.equal(wrote, true);
  assert.equal(await readFile(join(dir, "2026-08-03.md"), "utf8"), "# real digest\n");
});

test("writeDigest writes an empty digest when none exists yet", async () => {
  const dir = await scratch();
  const wrote = await writeDigest("2026-08-03", "# empty\n", 0, dir);
  assert.equal(wrote, true);
  assert.equal(await readFile(join(dir, "2026-08-03.md"), "utf8"), "# empty\n");
});

test("writeDigest refuses to replace an existing digest with an empty one", async () => {
  const dir = await scratch();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "2026-08-03.md"), "# real digest\n", "utf8");

  const wrote = await writeDigest("2026-08-03", "# empty placeholder\n", 0, dir);

  assert.equal(wrote, false, "a zero-item re-run must not clobber the committed digest");
  assert.equal(await readFile(join(dir, "2026-08-03.md"), "utf8"), "# real digest\n");
});

test("writeDigest overwrites an existing digest when there are items", async () => {
  const dir = await scratch();
  await writeFile(join(dir, "2026-08-03.md"), "# old\n", "utf8");
  const wrote = await writeDigest("2026-08-03", "# new\n", 3, dir);
  assert.equal(wrote, true);
  assert.equal(await readFile(join(dir, "2026-08-03.md"), "utf8"), "# new\n");
});

test("same-day re-run: renderDigest placeholder (no items passed threshold) doesn't overwrite committed digest", async () => {
  const dir = await scratch();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "2026-08-03.md"), "# AI/Agents Digest — 2026-08-03\n\n- [Good item](https://example.com)\n", "utf8");

  const placeholderMarkdown = "# AI/Agents Digest — 2026-08-03\n\n_No items cleared the relevance threshold this week._\n";
  const wrote = await writeDigest("2026-08-03", placeholderMarkdown, 0, dir);

  assert.equal(wrote, false, "placeholder must not clobber committed digest even on re-run");
  assert.equal(await readFile(join(dir, "2026-08-03.md"), "utf8"), "# AI/Agents Digest — 2026-08-03\n\n- [Good item](https://example.com)\n");
});
