import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import { AudioSample, AudioSampleSource, BufferTarget, Mp3OutputFormat, Output } from "mediabunny";
import { MP3_BITRATE_KBPS } from "./config.js";

const SAMPLE_RATE = 24_000;

let registered = false;

/**
 * WASM LAME. Deliberately not @mediabunny/server: that would pull node-av's
 * native FFmpeg bindings into the tree. `AudioSampleSource` (not
 * `AudioBufferSource`) because the latter's `.add()` takes a real Web Audio API
 * `AudioBuffer`, which doesn't exist in Node — `AudioSample` with format "s16"
 * accepts the raw PCM bytes directly, no float conversion needed. Do NOT set a
 * sampleRate other than 24000 here to force 44.1kHz — it reinterprets rather
 * than resamples, producing fast, high-pitched audio. The episode ships as
 * 24kHz MPEG-2 Layer III, which is normal for speech.
 */
export async function encodeMp3(pcm: Buffer): Promise<Buffer> {
  if (!registered) {
    registerMp3Encoder();
    registered = true;
  }

  const target = new BufferTarget();
  const output = new Output({ format: new Mp3OutputFormat(), target });
  const source = new AudioSampleSource({ codec: "mp3", bitrate: MP3_BITRATE_KBPS * 1000 });
  output.addAudioTrack(source);
  await output.start();

  const data = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const sample = new AudioSample({
    data,
    format: "s16",
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
    timestamp: 0,
  });
  await source.add(sample);
  sample.close();
  source.close();
  await output.finalize();

  if (!target.buffer) throw new Error("mp3 encoder produced no output");
  return Buffer.from(target.buffer);
}
