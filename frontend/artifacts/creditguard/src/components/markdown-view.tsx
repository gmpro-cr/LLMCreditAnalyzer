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

// Right-align a table column only when its body cells are figures (₹ amounts,
// %, x multiples, days, "—"); text columns (risks, remarks) stay left-aligned.
type HNode = { type: string; tagName?: string; value?: string; children?: HNode[]; properties?: Record<string, unknown> };
const NUM = /^[-+−]?\s*(?:₹|Rs\.?)?\s*[\d,]+(?:\.\d+)?\s*(?:%|x|Cr|cr|days|d|bps|pp)?$|^[—–-]$/;
const text = (n: HNode): string => n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(text).join("");
function rehypeNumericColumns() {
  return (tree: HNode) => {
    const walk = (n: HNode) => {
      // Wide tables (a 10-year spread) scroll inside their own box instead of
      // spilling out of the memo sheet.
      (n.children ?? []).forEach((c, i) => {
        if (c.tagName === "table" && n.tagName !== "div") {
          (n.children as HNode[])[i] = { type: "element", tagName: "div", properties: { className: ["table-scroll"] }, children: [c] };
        }
      });
      if (n.tagName === "table") {
        const rows: HNode[] = [];
        const collect = (x: HNode) => { if (x.tagName === "tr") rows.push(x); else (x.children ?? []).forEach(collect); };
        collect(n);
        const cells = (r: HNode) => (r.children ?? []).filter((c) => c.tagName === "td" || c.tagName === "th");
        const body = rows.filter((r) => cells(r).some((c) => c.tagName === "td"));
        const width = Math.max(0, ...rows.map((r) => cells(r).length));
        for (let j = 1; j < width; j++) {
          const vals = body.map((r) => text(cells(r)[j] ?? { type: "text", value: "" }).trim()).filter(Boolean);
          const numeric = vals.length > 0 && vals.filter((v) => NUM.test(v)).length / vals.length >= 0.6;
          if (!numeric) continue;
          for (const r of rows) {
            const c = cells(r)[j];
            if (c) c.properties = { ...(c.properties ?? {}), className: ["num"] };
          }
        }
      }
      (n.children ?? []).forEach(walk);
    };
    walk(tree);
  };
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

export function MarkdownView({ content, className = "", variant = "ui" }: { content: string; className?: string; variant?: "ui" | "document" }) {
  if (!content?.trim()) return null;
  return (
    <div className={`prose max-w-none dark:prose-invert prose-p:my-2.5 prose-li:my-0.5 prose-headings:font-semibold ${variant === "document" ? "memo-doc" : "prose-sm"} ${className}`}>
      {parts(content).map((p, i) =>
        p.kind === "org"
          ? (p.data ? <Organogram key={i} data={p.data} /> : null)
          : (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize, rehypeNumericColumns]}>
              {fixTableBlankLines(p.text)}
            </ReactMarkdown>
          ))}
    </div>
  );
}
