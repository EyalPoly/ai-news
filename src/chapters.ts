import { segmentWords } from "./script.js";
import type { ExtractedItem, ParsedScript } from "./types.js";

export interface Chapter {
  title: string;
  startMs: number;
  endMs: number;
}

/**
 * TTS returns one PCM blob per chunk of possibly several segments, so no real
 * per-segment duration exists — boundaries are estimated by splitting the
 * episode's actual measured duration proportionally by word count. Segment
 * order is playback order (chunkSegments/renderChunk never reorder). The
 * first and last chapters absorb the spoken intro/outro (buildScriptPrompt
 * puts them there), so those two boundaries run a little early/late relative
 * to where the story itself starts.
 */
export function computeChapters(
  script: ParsedScript,
  items: ExtractedItem[],
  durationSec: number,
): Chapter[] {
  const totalWords = script.segments.reduce((sum, s) => sum + segmentWords(s), 0);
  if (totalWords === 0) return [];

  const msPerWord = (durationSec * 1000) / totalWords;
  const chapters: Chapter[] = [];
  let cursorMs = 0;

  for (const segment of script.segments) {
    const item = items[segment.index - 1];
    const startMs = Math.round(cursorMs);
    cursorMs += segmentWords(segment) * msPerWord;
    chapters.push({
      title: item?.title ?? `Item ${segment.index}`,
      startMs,
      endMs: Math.round(cursorMs),
    });
  }

  // Rounding drift must not leave the last chapter short of the real duration.
  const last = chapters[chapters.length - 1];
  if (last) last.endMs = Math.round(durationSec * 1000);

  return chapters;
}
