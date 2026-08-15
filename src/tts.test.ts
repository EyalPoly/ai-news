import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chunkSegments,
  concatPcm,
  estimateSeconds,
  pcmDurationSec,
  renderChunk,
  silencePcm,
  wavFromPcm,
} from "./tts.js";
import type { Segment } from "./types.js";

function segment(index: number, words: number, speakers = ["Maya", "Daniel"]): Segment {
  const perTurn = Math.ceil(words / speakers.length);
  return {
    index,
    turns: speakers.map((speaker) => ({
      speaker,
      text: Array.from({ length: perTurn }, () => "word").join(" "),
    })),
  };
}

test("estimateSeconds converts words at SPEECH_WPM", () => {
  assert.equal(estimateSeconds(150), 60);
  assert.equal(estimateSeconds(450), 180);
});

test("chunkSegments packs whole segments up to the target", () => {
  // 150 words ~ 60s each, target 180s -> 3 per chunk.
  const chunks = chunkSegments([1, 2, 3, 4, 5, 6, 7].map((i) => segment(i, 150)));
  assert.deepEqual(chunks.map((c) => c.length), [3, 3, 1]);
});

test("chunkSegments never splits a segment across chunks", () => {
  const segments = [1, 2, 3, 4, 5, 6].map((i) => segment(i, 200));
  const chunks = chunkSegments(segments);
  const flattened = chunks.flat().map((s) => s.index);
  assert.deepEqual(flattened, [1, 2, 3, 4, 5, 6]);
  const seen = new Set(flattened);
  assert.equal(seen.size, 6, "each segment appears exactly once");
});

test("chunkSegments gives an oversized segment its own chunk rather than splitting it", () => {
  const chunks = chunkSegments([segment(1, 100), segment(2, 900), segment(3, 100)]);
  assert.deepEqual(chunks.map((c) => c.map((s) => s.index)), [[1], [2], [3]]);
});

test("chunkSegments returns nothing for no segments", () => {
  assert.deepEqual(chunkSegments([]), []);
});

test("renderChunk emits one labelled line per turn", () => {
  const text = renderChunk([{ index: 1, turns: [
    { speaker: "Maya", text: "Hello there." },
    { speaker: "Daniel", text: "Hi." },
  ] }]);
  assert.equal(text, "Maya: Hello there.\nDaniel: Hi.");
});

test("silencePcm produces the right number of zero bytes, always even", () => {
  const buf = silencePcm(500);
  assert.equal(buf.length, 24_000);
  assert.equal(buf.length % 2, 0);
  assert.ok(buf.every((b) => b === 0));
  assert.equal(silencePcm(1).length % 2, 0, "an odd byte count would shift every later sample");
});

test("concatPcm joins chunks with seam silence between them only", () => {
  const a = Buffer.alloc(1000, 1);
  const b = Buffer.alloc(2000, 2);
  const seam = silencePcm(500).length;

  assert.equal(concatPcm([a, b]).length, 1000 + seam + 2000);
  assert.equal(concatPcm([a]).length, 1000, "a single chunk gets no seam");
  assert.equal(concatPcm([]).length, 0);
});

test("concatPcm preserves the original sample bytes around the seam", () => {
  const a = Buffer.alloc(4, 7);
  const b = Buffer.alloc(4, 9);
  const joined = concatPcm([a, b], 0);
  assert.deepEqual([...joined], [7, 7, 7, 7, 9, 9, 9, 9]);
});

test("pcmDurationSec derives duration from the byte count", () => {
  assert.equal(pcmDurationSec(Buffer.alloc(48_000)), 1);
  assert.equal(pcmDurationSec(Buffer.alloc(480_000)), 10);
});

test("wavFromPcm writes a correct 44-byte header", () => {
  const pcm = Buffer.alloc(48_000, 3);
  const wav = wavFromPcm(pcm);

  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.toString("ascii", 12, 16), "fmt ");
  assert.equal(wav.readUInt32LE(16), 16, "PCM fmt chunk size");
  assert.equal(wav.readUInt16LE(20), 1, "format 1 = PCM");
  assert.equal(wav.readUInt16LE(22), 1, "mono");
  assert.equal(wav.readUInt32LE(24), 24_000, "sample rate");
  assert.equal(wav.readUInt32LE(28), 48_000, "byte rate");
  assert.equal(wav.readUInt16LE(32), 2, "block align");
  assert.equal(wav.readUInt16LE(34), 16, "bits per sample");
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), pcm.length);
});
