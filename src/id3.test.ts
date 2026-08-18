import { test } from "node:test";
import assert from "node:assert/strict";
import NodeID3 from "node-id3";
import { embedChapters } from "./id3.js";
import type { Chapter } from "./chapters.js";

function fakeMp3(bytes = 1000): Buffer {
  return Buffer.alloc(bytes, 0);
}

test("embedChapters returns the input unchanged when there are no chapters", () => {
  const mp3 = fakeMp3();
  const result = embedChapters(mp3, []);
  assert.equal(result, mp3);
});

test("embedChapters writes readable CHAP frames with the right titles and times", () => {
  const chapters: Chapter[] = [
    { title: "First Story", startMs: 0, endMs: 5000 },
    { title: "Second Story", startMs: 5000, endMs: 12000 },
  ];

  const tagged = embedChapters(fakeMp3(), chapters);
  assert.ok(tagged.length > 1000, "expected the tagged buffer to be larger than the input");

  const read = NodeID3.read(tagged);
  assert.equal(read.chapter?.length, 2);
  assert.equal(read.chapter?.[0]?.tags?.title, "First Story");
  assert.equal(read.chapter?.[0]?.startTimeMs, 0);
  assert.equal(read.chapter?.[0]?.endTimeMs, 5000);
  assert.equal(read.chapter?.[1]?.tags?.title, "Second Story");
  assert.equal(read.chapter?.[1]?.startTimeMs, 5000);
  assert.equal(read.chapter?.[1]?.endTimeMs, 12000);
});

test("embedChapters writes an ordered table of contents referencing every chapter", () => {
  const chapters: Chapter[] = [
    { title: "A", startMs: 0, endMs: 1000 },
    { title: "B", startMs: 1000, endMs: 2000 },
    { title: "C", startMs: 2000, endMs: 3000 },
  ];

  const tagged = embedChapters(fakeMp3(), chapters);
  const read = NodeID3.read(tagged);

  assert.equal(read.tableOfContents?.length, 1);
  assert.equal(read.tableOfContents?.[0]?.isOrdered, true);
  assert.deepEqual(read.tableOfContents?.[0]?.elements, ["chp0", "chp1", "chp2"]);
});
