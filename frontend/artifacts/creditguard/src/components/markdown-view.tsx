import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Organogram, type OrganogramData } from "@/components/organogram";

// Ensure GFM tables are block-level by guaranteeing a blank line before the
// FIRST row of a table. The regex only matches when a non-pipe character
// precedes the newline, so it inserts a blank line before a table starts
// but NOT between consecutive table rows (which would break the table).
function fixTableBlankLines(text: string): string {
  return text.replace(/([^\n|])\n(\|)/g, "$1\n\n$2");
}

// The detailed CAM embeds the group diagram as a ```organogram JSON block;
// split it out and render it as SVG between the markdown parts.
const ORG_BLOCK = /```organogram\s*\n([\s\S]*?)\n```/g;

function parts(content: string): ({ kind: "md"; text: string } | { kind: "org"; data: OrganogramData | null })[] {
  const out: ({ kind: "md"; text: string } | { kind: "org"; data: OrganogramData | null })[] = [];
  let last = 0;
  for (const m of content.matchAll(ORG_BLOCK)) {
    if (m.index! > last) out.push({ kind: "md", text: content.slice(last, m.index) });
    let data: OrganogramData | null = null;
    try { data = JSON.parse(m[1]) as OrganogramData; } catch { data = null; }
    out.push({ kind: "org", data });
    last = m.index! + m[0].length;
  }
  if (last < content.length) out.push({ kind: "md", text: content.slice(last) });
  return out;
}

export function MarkdownView({ content, className = "" }: { content: string; className?: string }) {
  if (!content?.trim()) return null;
  return (
    <div className={`prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-h2:text-base prose-h3:text-sm prose-p:leading-relaxed prose-p:my-2 prose-li:my-0.5 prose-table:text-xs prose-th:bg-muted/50 ${className}`}>
      {parts(content).map((p, i) =>
        p.kind === "org"
          ? (p.data ? <Organogram key={i} data={p.data} /> : null)
          : (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {fixTableBlankLines(p.text)}
            </ReactMarkdown>
          ))}
    </div>
  );
}
