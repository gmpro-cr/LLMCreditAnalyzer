import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

// Ensure GFM tables are block-level by guaranteeing a blank line before the
// FIRST row of a table. The regex only matches when a non-pipe character
// precedes the newline, so it inserts a blank line before a table starts
// but NOT between consecutive table rows (which would break the table).
function fixTableBlankLines(text: string): string {
  return text.replace(/([^\n|])\n(\|)/g, "$1\n\n$2");
}

export function MarkdownView({ content, className = "" }: { content: string; className?: string }) {
  if (!content?.trim()) return null;
  return (
    <div className={`prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-h2:text-base prose-h3:text-sm prose-p:leading-relaxed prose-p:my-2 prose-li:my-0.5 prose-table:text-xs prose-th:bg-muted/50 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {fixTableBlankLines(content)}
      </ReactMarkdown>
    </div>
  );
}
