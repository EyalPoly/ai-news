import {
  PCM_BYTES_PER_SECOND,
  PODCAST_SPEAKERS,
  PODCAST_TTS_MODEL,
  SPEECH_WPM,
  TTS_CHUNK_TARGET_SECONDS,
  TTS_SEAM_SILENCE_MS,
} from "./config.js";
import { generateSpeech } from "./gemini.js";
import { encodeMp3 } from "./mp3.js";
import { withRetry } from "./retry.js";
import { segmentWords } from "./script.js";
import type { ParsedScript, Segment } from "./types.js";

const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

export function estimateSeconds(words: number): number {
  return (words / SPEECH_WPM) * 60;
}

/**
 * Chunks break on item boundaries, never inside a segment or a turn. An item
 * boundary is a topic change, so prosody drift between independently generated
 * chunks reads as editing rather than a glitch mid-story. A segment that alone
 * exceeds the target becomes its own chunk — overflow is safe given the headroom
 * between this target and the per-call output cap.
 */
export function chunkSegments(
  segments: Segment[],
  targetSeconds = TTS_CHUNK_TARGET_SECONDS,
): Segment[][] {
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let currentSeconds = 0;

  for (const segment of segments) {
    const seconds = estimateSeconds(segmentWords(segment));
    if (current.length > 0 && currentSeconds + seconds > targetSeconds) {
      chunks.push(current);
      current = [];
      currentSeconds = 0;
    }
    current.push(segment);
    currentSeconds += seconds;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function renderChunk(segments: Segment[]): string {
  return segments
    .flatMap((segment) => segment.turns.map((turn) => `${turn.speaker}: ${turn.text}`))
    .join("\n");
}

/** In signed 16-bit PCM, silence is simply zero bytes — no DSP required. */
export function silencePcm(ms: number): Buffer {
  const bytes = Math.round((PCM_BYTES_PER_SECOND * ms) / 1000);
  return Buffer.alloc(bytes - (bytes % 2));
}

/**
 * Concatenate at the PCM stage, before encoding. Headerless fixed-width PCM has
 * no framing, so byte-level append yields continuous audio. Concatenating WAVs
 * would embed a 44-byte header mid-stream (an audible click); concatenating MP3s
 * would hit frame headers plus encoder delay and padding at every seam.
 */
export function concatPcm(chunks: Buffer[], seamMs = TTS_SEAM_SILENCE_MS): Buffer {
  if (chunks.length === 0) return Buffer.alloc(0);
  const seam = silencePcm(seamMs);
  const parts: Buffer[] = [];
  chunks.forEach((chunk, i) => {
    if (i > 0) parts.push(seam);
    parts.push(chunk);
  });
  return Buffer.concat(parts);
}

/** Exact, and needs no probing of the encoded file. Feeds <itunes:duration>. */
export function pcmDurationSec(pcm: Buffer): number {
  return pcm.length / PCM_BYTES_PER_SECOND;
}

/** Raw PCM will not play by double-clicking, and debugging seams means listening. */
export function wavFromPcm(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export interface SynthesisResult {
  mp3: Buffer;
  durationSec: number;
  chunks: number;
}

/**
 * Sequential, not Promise.all: the free tier is a few requests per minute, so
 * unlike score.ts this paces itself. A weekly job has no reason to hurry.
 * Concat once, encode once, at the end.
 */
export async function synthesizeEpisode(
  script: ParsedScript,
  fetchImpl: typeof fetch = fetch,
): Promise<SynthesisResult> {
  const chunks = chunkSegments(script.segments);
  if (chunks.length === 0) throw new Error("nothing to synthesize");

  const pcmChunks: Buffer[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const transcript = renderChunk(chunk);
    console.log(`[tts] chunk ${i + 1}/${chunks.length} — ${chunk.length} segment(s)`);
    pcmChunks.push(
      await withRetry(() =>
        generateSpeech(PODCAST_TTS_MODEL, transcript, PODCAST_SPEAKERS, fetchImpl),
      ),
    );
  }

  const pcm = concatPcm(pcmChunks);
  const durationSec = pcmDurationSec(pcm);
  const words = script.segments.reduce((sum, s) => sum + segmentWords(s), 0);
  // Calibration signal: replace the SPEECH_WPM guess once a few runs have logged this.
  console.log(
    `[tts] ${chunks.length} chunk(s), ${durationSec.toFixed(1)}s, measured ${(
      (words / durationSec) * 60
    ).toFixed(0)} wpm`,
  );

  return { mp3: await encodeMp3(pcm), durationSec, chunks: chunks.length };
}
