import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeed, escapeXml, formatDuration, rfc822 } from "./feed.js";
import type { Episode } from "./types.js";

function episode(p: Partial<Episode> = {}): Episode {
  return {
    date: p.date ?? "2026-08-03",
    title: p.title ?? "Claude Opus 5 lands",
    summary: p.summary ?? "A big week for agent tooling.",
    items: p.items ?? [
      { title: "Claude Opus 5", link: "https://anthropic.com/news/claude-opus-5", source: "HN" },
    ],
    audioUrl: p.audioUrl ?? "https://github.com/o/r/releases/download/episode-2026-08-03/e.mp3",
    bytes: p.bytes ?? 9_600_000,
    durationSec: p.durationSec ?? 612,
  };
}

test("escapeXml escapes the five XML entities", () => {
  assert.equal(escapeXml(`a & b < c > d " e ' f`), "a &amp; b &lt; c &gt; d &quot; e &apos; f");
});

test("rfc822 formats a date at noon UTC so no timezone shifts the day", () => {
  assert.equal(rfc822("2026-08-03"), "Mon, 03 Aug 2026 12:00:00 GMT");
});

test("formatDuration renders HH:MM:SS", () => {
  assert.equal(formatDuration(612), "00:10:12");
  assert.equal(formatDuration(3661), "01:01:01");
  assert.equal(formatDuration(9), "00:00:09");
});

test("buildFeed emits the elements Spotify requires", () => {
  const xml = buildFeed([episode()], new Date("2026-08-03T13:00:00Z"));
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /xmlns:itunes="http:\/\/www\.itunes\.com\/dtds\/podcast-1\.0\.dtd"/);
  assert.match(xml, /xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom"/);
  assert.match(xml, /<atom:link href="[^"]+\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/);
  assert.match(xml, /<itunes:category text="Technology"\/>/);
  assert.match(xml, /<itunes:explicit>false<\/itunes:explicit>/);
  assert.match(xml, /<itunes:owner>\s*<itunes:name>[^<]+<\/itunes:name>\s*<itunes:email>[^<]+<\/itunes:email>\s*<\/itunes:owner>/);
  assert.match(xml, /<itunes:image href="[^"]+\/cover\.jpg"\/>/);
  assert.match(xml, /<language>en-us<\/language>/);
});

test("buildFeed emits one item per episode with matching enclosure and duration", () => {
  const xml = buildFeed([episode(), episode({ date: "2026-08-10", title: "Second" })]);
  assert.equal(xml.match(/<item>/g)?.length, 2);
  assert.match(xml, /<enclosure url="[^"]+" length="9600000" type="audio\/mpeg"\/>/);
  assert.match(xml, /<itunes:duration>00:10:12<\/itunes:duration>/);
  assert.match(xml, /<guid isPermaLink="false">2026-08-03<\/guid>/);
});

test("buildFeed lists episodes newest first", () => {
  const xml = buildFeed([episode({ date: "2026-08-03" }), episode({ date: "2026-08-10" })]);
  assert.ok(xml.indexOf("2026-08-10") < xml.indexOf("2026-08-03"));
});

test("buildFeed escapes titles and cannot break out of CDATA", () => {
  const xml = buildFeed([
    episode({
      title: `Tom & Jerry <hack>`,
      items: [{ title: "closing ]]> bracket", link: "https://x/1?a=1&b=2", source: "S" }],
    }),
  ]);
  assert.match(xml, /<title>Tom &amp; Jerry &lt;hack&gt;<\/title>/);
  assert.doesNotMatch(xml, /\]\]>[^<]*<\/description>/);
  assert.match(xml, /href="https:\/\/x\/1\?a=1&amp;b=2"/);
});

test("buildFeed produces a valid channel with zero episodes", () => {
  const xml = buildFeed([]);
  assert.match(xml, /<channel>/);
  assert.doesNotMatch(xml, /<item>/);
});
