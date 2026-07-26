import type { Source } from "./types.js";

/**
 * Tiered feed list. Priority order: tools > learning > awareness.
 *
 * - tools     — release feeds & framework/tooling news a builder acts on directly.
 * - learning  — newsletters, technique writeups, lab/engineering blogs.
 * - awareness — broad signal (filtered HN, arXiv) to skim, lower priority.
 *
 * `weight` (1–5) is relative importance used in the final rank blend.
 * Add a source by appending an object here; run `npm run discovery` to find candidates.
 */
export const SOURCES: Source[] = [
  // ── learning ───────────────────────────────────────────────────────────
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", tier: "learning", weight: 5 },
  { name: "Latent Space", url: "https://www.latent.space/feed", tier: "learning", weight: 4 },
  { name: "Lilian Weng", url: "https://lilianweng.github.io/index.xml", tier: "learning", weight: 4 },
  { name: "Hugging Face blog", url: "https://huggingface.co/blog/feed.xml", tier: "learning", weight: 3 },
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml", tier: "learning", weight: 4 },
  { name: "Google Research blog", url: "https://research.google/blog/rss/", tier: "learning", weight: 3 },

  // ── awareness ──────────────────────────────────────────────────────────
  { name: "Hacker News (front page ≥150pts)", url: "https://hnrss.org/frontpage?points=150", tier: "awareness", weight: 2 },
  { name: "HN: LLM/agents (≥80pts)", url: "https://hnrss.org/newest?q=LLM+OR+agents+OR+Claude+OR+GPT&points=80", tier: "awareness", weight: 2 },
  { name: "arXiv cs.AI agents", url: "http://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+all:agent&start=0&max_results=40&sortBy=submittedDate&sortOrder=descending", tier: "awareness", weight: 1 },
];
