import Parser from "rss-parser";

interface AwesomeList {
  name: string;
  org: string;
  repo: string;
  branch: string;
}

const LISTS: AwesomeList[] = [
  { name: "e2b-dev/awesome-ai-agents", org: "e2b-dev", repo: "awesome-ai-agents", branch: "main" },
  { name: "kyrolabs/awesome-langchain", org: "kyrolabs", repo: "awesome-langchain", branch: "main" },
];

const parser = new Parser({ timeout: 20000 });

async function main(): Promise<void> {
  for (const list of LISTS) {
    const url = `https://github.com/${list.org}/${list.repo}/commits/${list.branch}.atom`;
    console.log(`\n## ${list.name}`);
    try {
      const feed = await parser.parseURL(url);
      const recent = (feed.items ?? []).slice(0, 15);
      for (const item of recent) {
        const title = item.title?.trim().split("\n")[0]?.trim() ?? "(no title)";
        const when = item.isoDate?.slice(0, 10) ?? "";
        console.log(`- ${when}  ${title}`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`  skipped: ${reason}`);
    }
  }
}

main().catch((err) => {
  console.error("[discovery] fatal:", err);
  process.exit(1);
});
