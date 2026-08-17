import {
  PODCAST_AUTHOR,
  PODCAST_CATEGORY,
  PODCAST_DESCRIPTION,
  PODCAST_EXPLICIT,
  PODCAST_LANGUAGE,
  PODCAST_OWNER_EMAIL,
  PODCAST_TITLE,
  SITE_BASE_URL,
} from "./config.js";
import type { Episode } from "./types.js";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RFC-822 pubDate. Built at noon UTC so no timezone can shift the calendar day. */
export function rfc822(date: string): string {
  return new Date(`${date}T12:00:00Z`).toUTCString();
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

const explicit = PODCAST_EXPLICIT ? "true" : "false";

/**
 * Show notes are built here, not by the model: they are the listener's only
 * link-out, and a hallucinated URL is worse than a dull title. Every value is
 * XML-escaped first, so `]]>` can never survive into the CDATA section.
 */
function showNotes(ep: Episode): string {
  const items = ep.items
    .map(
      (i) =>
        `<li><a href="${escapeXml(i.link)}">${escapeXml(i.title)}</a> — ${escapeXml(i.source)}</li>`,
    )
    .join("");
  return `<p>${escapeXml(ep.summary)}</p><ul>${items}</ul>`;
}

function renderItem(ep: Episode): string {
  return [
    "    <item>",
    `      <title>${escapeXml(ep.title)}</title>`,
    `      <description><![CDATA[${showNotes(ep)}]]></description>`,
    `      <pubDate>${rfc822(ep.date)}</pubDate>`,
    `      <guid isPermaLink="false">${escapeXml(ep.date)}</guid>`,
    `      <enclosure url="${escapeXml(ep.audioUrl)}" length="${ep.bytes}" type="audio/mpeg"/>`,
    `      <itunes:duration>${formatDuration(ep.durationSec)}</itunes:duration>`,
    `      <itunes:explicit>${explicit}</itunes:explicit>`,
    "    </item>",
  ].join("\n");
}

/** Pure: the whole feed is a function of the manifest. No I/O. */
export function buildFeed(episodes: Episode[], now = new Date()): string {
  const newestFirst = [...episodes].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(PODCAST_TITLE)}</title>`,
    `    <link>${escapeXml(SITE_BASE_URL)}</link>`,
    `    <description>${escapeXml(PODCAST_DESCRIPTION)}</description>`,
    `    <language>${escapeXml(PODCAST_LANGUAGE)}</language>`,
    `    <lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(`${SITE_BASE_URL}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    `    <itunes:author>${escapeXml(PODCAST_AUTHOR)}</itunes:author>`,
    `    <itunes:summary>${escapeXml(PODCAST_DESCRIPTION)}</itunes:summary>`,
    `    <itunes:explicit>${explicit}</itunes:explicit>`,
    `    <itunes:image href="${escapeXml(`${SITE_BASE_URL}/cover.jpg`)}"/>`,
    `    <itunes:category text="${escapeXml(PODCAST_CATEGORY)}"/>`,
    "    <itunes:owner>",
    `      <itunes:name>${escapeXml(PODCAST_AUTHOR)}</itunes:name>`,
    `      <itunes:email>${escapeXml(PODCAST_OWNER_EMAIL)}</itunes:email>`,
    "    </itunes:owner>",
    ...newestFirst.map(renderItem),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
