import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export function MarkdownView({ content, className = "" }: { content: string; className?: string }) {
  if (!content?.trim()) return null;
  return (
    <div className={`prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-h2:text-base prose-h3:text-sm prose-p:leading-relaxed prose-p:my-2 prose-li:my-0.5 prose-table:text-xs prose-th:bg-muted/50 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
