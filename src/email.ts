import nodemailer from "nodemailer";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline-style markdown links and bold/italic within an already-escaped line. */
function renderInline(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" style="color:#0b5cad;text-decoration:none">$1</a>')
    .replace(/\*([^*]+)\*/g, '<span style="color:#666;font-size:12px">$1</span>');
}

/** Convert the digest's simple markdown subset to inline-styled HTML. */
export function markdownToHtml(markdown: string): string {
  const body = markdown
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "") return "";
      const esc = escapeHtml(trimmed);
      if (trimmed.startsWith("# ")) return `<h1 style="font-family:sans-serif;font-size:22px">${renderInline(esc.slice(2))}</h1>`;
      if (trimmed.startsWith("## ")) return `<h2 style="font-family:sans-serif;font-size:18px;border-bottom:1px solid #eee;padding-bottom:4px">${renderInline(esc.slice(3))}</h2>`;
      if (trimmed.startsWith("- ")) return `<p style="font-family:sans-serif;font-size:14px;margin:8px 0">${renderInline(esc.slice(2))}</p>`;
      return `<p style="font-family:sans-serif;font-size:14px;color:#666;margin:2px 0 8px">${renderInline(esc)}</p>`;
    })
    .join("\n");
  return `<div style="max-width:680px;margin:0 auto;color:#111">${body}</div>`;
}

/** Send the digest via Gmail SMTP. Best-effort: never throws. */
export async function sendDigest(subject: string, markdown: string): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log("[email] GMAIL_USER/GMAIL_APP_PASSWORD unset — skipping send");
    return;
  }
  const to = process.env.DIGEST_TO || user;
  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transport.sendMail({
      from: user,
      to,
      subject,
      text: markdown,
      html: markdownToHtml(markdown),
    });
    console.log(`[email] sent digest to ${to}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[email] send failed (continuing): ${reason}`);
  }
}
