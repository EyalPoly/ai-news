import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeMp3 } from "./mp3.js";
import { pcmDurationSec } from "./tts.js";

/** Two seconds of a quiet 440Hz tone as 24kHz mono s16le. */
function tone(seconds: number): Buffer {
  const samples = 24_000 * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 24_000) * 8000), i * 2);
  }
  return pcm;
}

test("encodeMp3 produces a non-trivially compressed MP3 with a frame sync", async () => {
  const pcm = tone(2);
  const mp3 = await encodeMp3(pcm);

  assert.ok(mp3.length > 0, "encoder returned no bytes");
  assert.ok(mp3.length < pcm.length, "MP3 should be smaller than raw PCM");

  // Skip any ID3v2 tag, then expect an MPEG frame sync (11 set bits).
  const start = mp3.toString("ascii", 0, 3) === "ID3"
    ? 10 + ((mp3[6]! << 21) | (mp3[7]! << 14) | (mp3[8]! << 7) | mp3[9]!)
    : 0;
  assert.equal(mp3[start], 0xff);
  assert.equal((mp3[start + 1]! & 0xe0), 0xe0);
});

test("pcmDurationSec agrees with the tone length that was encoded", () => {
  assert.equal(pcmDurationSec(tone(2)), 2);
});
