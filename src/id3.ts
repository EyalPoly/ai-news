import NodeID3 from "node-id3";
import type { Chapter } from "./chapters.js";

/**
 * Spotify reads chapter markers from ID3v2 CHAP/CTOC frames embedded in the
 * MP3 itself (the original Anchor.fm feature), not the Podcasting-2.0 RSS
 * <podcast:chapters> tag, so chapters must be written into the file.
 */
export function embedChapters(mp3: Buffer, chapters: Chapter[]): Buffer {
  if (chapters.length === 0) return mp3;

  const elementIDs = chapters.map((_, i) => `chp${i}`);

  return NodeID3.write(
    {
      chapter: chapters.map((c, i) => ({
        elementID: elementIDs[i] as string,
        startTimeMs: c.startMs,
        endTimeMs: c.endMs,
        tags: { title: c.title },
      })),
      tableOfContents: [{ elementID: "toc", isOrdered: true, elements: elementIDs }],
    },
    mp3,
  );
}
