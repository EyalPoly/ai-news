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
