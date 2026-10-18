import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';

/**
 * 正文 Markdown 渲染（懒加载模块）。
 * 独立成 chunk：首屏（图谱/侧栏）不携带 react-markdown + rehype 家族体积，
 * 仅在详情面板真正展示正文时按需加载。
 */
export interface MarkdownViewProps {
  content: string;
  components?: Components;
}

export default function MarkdownView({ content, components }: MarkdownViewProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeHighlight]}
      components={components}>
      {content}
    </ReactMarkdown>
  );
}
