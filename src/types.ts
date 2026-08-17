export type Tier = "tools" | "learning" | "awareness";

export interface Source {
  name: string;
  url: string;
  tier: Tier;
  /** Relative importance within/across tiers, scale 1–5. */
  weight: number;
}

/** A feed entry normalized to a common shape. */
export interface FeedItem {
  /** Content hash of link + title — stable dedup key across runs. */
  id: string;
  title: string;
  link: string;
  /** Source name this item came from. */
  source: string;
  tier: Tier;
  weight: number;
  /** Publication time, epoch milliseconds. */
  publishedAt: number;
}

export type Category =
  | "model-release"
  | "agents-tooling"
  | "technique-research"
  | "engineering"
  | "ecosystem";

/** The scoring model's judgment for a single item. */
export interface Score {
  relevance: number; // 0–10
  category: Category;
}

/** A feed item enriched with its score and final blended rank. */
export interface ScoredItem extends FeedItem, Score {
  rank: number;
}

/** One link listed in an episode's show notes. */
export interface EpisodeItem {
  title: string;
  link: string;
  source: string;
}

/** A published episode, as persisted in state/episodes.json and rendered into the feed. */
export interface Episode {
  /** YYYY-MM-DD. Doubles as the RSS guid. */
  date: string;
  title: string;
  summary: string;
  items: EpisodeItem[];
  /** GitHub release asset URL. */
  audioUrl: string;
  /** <enclosure length> — byte size of the MP3. */
  bytes: number;
  /** <itunes:duration> — derived exactly from the PCM byte count. */
  durationSec: number;
}

/** A scored item plus its extracted article text, or null when extraction failed. */
export interface ExtractedItem extends ScoredItem {
  text: string | null;
  /** Why extraction failed, for logs. Absent on success. */
  failure?: string;
}

/** One spoken line: which host says it, and what they say. */
export interface Turn {
  speaker: string;
  text: string;
}

/** All turns for one news item, delimited in the model output by [[ITEM n]]. */
export interface Segment {
  /** 1-based, matching the [[ITEM n]] marker. */
  index: number;
  turns: Turn[];
}

export interface ParsedScript {
  title: string;
  summary: string;
  segments: Segment[];
}
