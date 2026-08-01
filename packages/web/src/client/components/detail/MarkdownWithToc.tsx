/**
 * MarkdownWithToc — 带目录的 Markdown 渲染组件
 *
 * 从 DetailPanel.tsx 拆分：提取标题（h1-h6）生成浮动目录，
 * 点击目录项平滑滚动到对应标题。
 */
import { Tag, Button } from 'antd';
import { MenuOutlined } from '@ant-design/icons';
import {
  useState,
  useRef as useReactRef,
  useEffect,
  useMemo,
  memo,
  isValidElement,
  createElement,
  type ReactNode,
  type ReactElement,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';

// ── Markdown 目录（TOC）辅助函数 ──

function slugifyToc(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'heading'
  );
}

function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractTocHeadings(markdown: string): { level: number; text: string; id: string }[] {
  const headings: { level: number; text: string; id: string }[] = [];
  const usedIds = new Map<string, number>();
  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (!match) continue;
    const level = match[1].length;
    const text = stripMarkdownSyntax(match[2].trim());
    let id = slugifyToc(text);
    const count = usedIds.get(id) || 0;
    if (count > 0) id = `${id}-${count + 1}`;
    usedIds.set(id, count + 1);
    headings.push({ level, text, id });
  }
  return headings;
}

function getTextFromNode(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextFromNode).join('');
  if (isValidElement(node))
    return getTextFromNode((node.props as { children?: ReactNode }).children);
  return '';
}

const tocHeadingComponents: Record<
  string,
  (props: { children?: ReactNode; [k: string]: unknown }) => ReactElement
> = {};
for (let level = 1; level <= 6; level++) {
  const tag = `h${level}`;
  tocHeadingComponents[tag] = ({ children, ...props }) => {
    const id = slugifyToc(getTextFromNode(children));
    return createElement(tag, { ...props, id, 'data-toc-id': id }, children);
  };
}

export const MarkdownWithToc = memo(function MarkdownWithToc({ content }: { content: string }) {
  const containerRef = useReactRef<HTMLDivElement>(null);
  const tocRef = useReactRef<HTMLDivElement>(null);
  const headings = useMemo(() => extractTocHeadings(content), [content]);
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    if (!tocOpen) return;
    const handler = (e: MouseEvent) => {
      if (tocRef.current && !tocRef.current.contains(e.target as Node)) {
        setTocOpen(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handler);
    };
  }, [tocOpen]);

  const scrollToHeading = (id: string) => {
    const el = containerRef.current?.querySelector(`[data-toc-id="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTocOpen(false);
  };

  return (
    <div className='markdown-toc-container' ref={containerRef}>
      <div className='markdown-body detail-markdown'>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeHighlight]}
          components={tocHeadingComponents}>
          {content}
        </ReactMarkdown>
      </div>
      {headings.length >= 2 && (
        <div className='markdown-toc-float' ref={tocRef}>
          {tocOpen && (
            <div className='markdown-toc-float__panel'>
              <div className='markdown-toc-float__header'>
                <span>目录</span>
                <Tag color='blue' style={{ fontSize: 10, margin: 0 }}>
                  {headings.length}
                </Tag>
              </div>
              <div className='markdown-toc-float__list'>
                {headings.map((h, i) => (
                  <a
                    key={i}
                    className={`markdown-toc-float__item markdown-toc-float__item--level-${Math.min(h.level, 4)}`}
                    title={h.text}
                    onClick={() => scrollToHeading(h.id)}>
                    {h.text}
                  </a>
                ))}
              </div>
            </div>
          )}
          <Button
            type='primary'
            shape='circle'
            size='small'
            icon={<MenuOutlined />}
            className={`markdown-toc-float__btn${tocOpen ? ' markdown-toc-float__btn--active' : ''}`}
            onClick={() => setTocOpen(!tocOpen)}
          />
        </div>
      )}
    </div>
  );
});
