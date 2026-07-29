/**
 * 块渲染组件集 — CC/Codex 风格线性块流
 *
 * 唯一渲染入口 ContentRenderer，直接消费协议 NodeContent（历史与流式同一类型）。
 * 渲染前经 groupToolBlocks 视图层配对：一次工具调用 = 一个视觉单元（call + result 合并）。
 * 拆分结构：Collapsible（外壳）/ ThinkingBlock（计时）/ ToolBlock（合并卡片 + subagent）/
 *           FileChangeSummary（回合末汇总）/ 其余块在本文件。
 */
import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NodeContent, TokenUsage } from '@qcqx/lattice-agent-protocol';
import { groupToolBlocks } from '../turnSummary';
import { Collapsible } from './Collapsible';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolGroupBlock } from './ToolBlock';

export { FileChangeSummary } from './FileChangeSummary';

// ── 流式块渲染 ──

function TextBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div
      className='agent-md-block'
      style={{
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--text)',
        wordBreak: 'break-word',
        margin: '4px 0',
      }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: CodeBlockWithCopy,
        }}>
        {text}
      </ReactMarkdown>
      {streaming && <span style={{ opacity: 0.6 }}>▊</span>}
    </div>
  );
}

/** 代码块 + 复制按钮 */
function CodeBlockWithCopy({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const extractText = (node: React.ReactNode): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (node && typeof node === 'object' && 'props' in node) {
      return extractText((node as { props: { children?: React.ReactNode } }).props.children);
    }
    return '';
  };
  const handleCopy = useCallback(() => {
    const code = extractText(children).replace(/\n$/, '');
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  return (
    <div style={{ position: 'relative', margin: '4px 0' }}>
      <button
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          padding: '2px 6px',
          fontSize: 9,
          borderRadius: 3,
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          color: copied ? '#52c41a' : 'var(--text-secondary)',
          cursor: 'pointer',
          opacity: 0.8,
        }}>
        {copied ? '✓' : '📋'}
      </button>
      <pre
        style={{
          margin: 0,
          padding: '8px 10px',
          background: 'var(--bg-tertiary)',
          borderRadius: 6,
          overflow: 'auto',
          fontSize: 11,
        }}>
        {children}
      </pre>
    </div>
  );
}

const DIFF_KIND_LABEL: Record<string, string> = {
  create: '新建',
  edit: '编辑',
  delete: '删除',
};

function FileEditBlock({
  path,
  diff,
  kind,
}: {
  path: string;
  diff?: string;
  kind?: 'create' | 'edit' | 'delete';
}) {
  const lines = diff ? diff.split('\n').length : 0;
  const label = diff
    ? `${path}（${lines}行变更）`
    : `${path}${kind ? `（${DIFF_KIND_LABEL[kind]}）` : ''}`;
  return (
    <Collapsible label={label} icon='📝'>
      {diff ? (
        <pre style={{ margin: 0, fontSize: 10, overflow: 'auto', maxHeight: 150, lineHeight: 1.4 }}>
          {diff.split('\n').map((line, i) => (
            <div
              key={i}
              style={{
                color: line.startsWith('+')
                  ? '#52c41a'
                  : line.startsWith('-')
                    ? '#ff4d4f'
                    : 'var(--text-secondary)',
              }}>
              {line}
            </div>
          ))}
        </pre>
      ) : (
        <span style={{ color: 'var(--text-secondary)' }}>无 diff 详情</span>
      )}
    </Collapsible>
  );
}

function TerminalBlock({ command, output }: { command: string; output?: string }) {
  return (
    <Collapsible label={`$ ${command}`} icon='⚡' status='done'>
      {output && (
        <pre
          style={{
            margin: 0,
            fontSize: 10,
            color: 'var(--text-secondary)',
            overflow: 'auto',
            maxHeight: 120,
            fontFamily: 'monospace',
          }}>
          {output}
        </pre>
      )}
    </Collapsible>
  );
}

function ErrorBlock({ message, suggestion }: { message: string; suggestion?: string }) {
  return (
    <div
      style={{
        margin: '4px 0',
        padding: '6px 8px',
        borderRadius: 6,
        borderLeft: '3px solid #ff4d4f',
        background: 'rgba(255,77,79,0.06)',
        fontSize: 11,
      }}>
      <div style={{ color: '#ff4d4f' }}>{message}</div>
      {suggestion && (
        <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{suggestion}</div>
      )}
    </div>
  );
}

// ── 内容块分发（唯一渲染入口，消费 NodeContent） ──

/** 源上下文压缩分隔标记：此处之前的历史已被源摘要替代 */
function CompactionBlock({
  trigger,
  preTokens,
  summary,
}: {
  trigger: 'auto' | 'manual';
  preTokens?: number;
  summary?: string;
}) {
  const label = `上下文已压缩${trigger === 'manual' ? '（手动）' : ''}${
    preTokens ? ` · 压缩前 ${Math.round(preTokens / 1000)}k tokens` : ''
  }`;
  return (
    <div style={{ margin: '6px 0', fontSize: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--text-secondary)',
        }}>
        <div style={{ flex: 1, borderTop: '1px dashed var(--border-color, #444)' }} />
        <span>🗜 {label}</span>
        <div style={{ flex: 1, borderTop: '1px dashed var(--border-color, #444)' }} />
      </div>
      {summary && (
        <Collapsible label='压缩摘要' icon='📄' status='done'>
          <pre
            style={{
              margin: 0,
              fontSize: 10,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              maxHeight: 160,
              overflow: 'auto',
            }}>
            {summary}
          </pre>
        </Collapsible>
      )}
    </div>
  );
}

/** 非致命提示（不影响节点状态，区别于 ErrorBlock） */
function NoticeBlock({ level, text }: { level: 'info' | 'warning'; text: string }) {
  const color = level === 'warning' ? '#faad14' : 'var(--text-secondary)';
  return (
    <div
      style={{
        margin: '4px 0',
        padding: '4px 8px',
        borderRadius: 6,
        borderLeft: `3px solid ${color}`,
        background: level === 'warning' ? 'rgba(250,173,20,0.06)' : 'var(--bg-tertiary)',
        fontSize: 11,
        color,
      }}>
      {level === 'warning' ? '⚠ ' : ''}
      {text}
    </div>
  );
}

function ContentBlockRenderer({ block, streaming }: { block: NodeContent; streaming?: boolean }) {
  switch (block.type) {
    case 'text':
      return <TextBlock text={block.text} streaming={streaming} />;
    case 'code':
      return (
        <pre
          style={{
            fontSize: 10,
            padding: 6,
            background: 'var(--bg-tertiary)',
            borderRadius: 4,
            overflow: 'auto',
          }}>
          {block.text}
        </pre>
      );
    case 'thinking':
      return (
        <ThinkingBlock
          text={block.text}
          startedAt={block.startedAt}
          endedAt={block.endedAt}
          active={streaming}
        />
      );
    case 'diff':
      return <FileEditBlock path={block.path} diff={block.text} kind={block.kind} />;
    case 'image':
      return (
        <img
          src={`data:${block.mimeType};base64,${block.data}`}
          alt='image'
          style={{ maxWidth: '100%', borderRadius: 4, margin: '4px 0' }}
        />
      );
    case 'terminal':
      return <TerminalBlock command={block.command} output={block.output} />;
    case 'error':
      return <ErrorBlock message={block.message} suggestion={block.suggestion} />;
    case 'compaction':
      return (
        <CompactionBlock
          trigger={block.trigger}
          preTokens={block.preTokens}
          summary={block.summary}
        />
      );
    case 'notice':
      return <NoticeBlock level={block.level} text={block.text} />;
  }
}

/**
 * 渲染一组 NodeContent（历史回复与流式生成共用）
 * 渲染前经 groupToolBlocks 配对：tool_call + tool_result 合并为一个卡片，
 * 孤儿 tool_result（无对应 call）原样渲染兜底。
 */
export function ContentRenderer({
  content,
  streaming,
}: {
  content: NodeContent[];
  streaming?: boolean;
}) {
  const renderBlocks = groupToolBlocks(content);
  return (
    <>
      {renderBlocks.map((block, i) => {
        const isLast = i === renderBlocks.length - 1;
        if (block.type === 'tool-group') {
          // 稳定 key：配对后位置不随 result 到达而漂移，避免卡片重挂载丢状态
          return <ToolGroupBlock key={`tg-${block.call.toolId}`} group={block} />;
        }
        return (
          <ContentBlockRenderer
            key={`${block.type}-${i}`}
            block={block}
            streaming={streaming && isLast}
          />
        );
      })}
    </>
  );
}

// ── Usage 脚注 ──

export function UsageFooter({ usage, model }: { usage?: TokenUsage; model?: string }) {
  if (!usage && !model) return null;
  const parts: string[] = [];
  if (usage) {
    if (usage.input) parts.push(`↑${fmt(usage.input)}`);
    if (usage.output) parts.push(`↓${fmt(usage.output)}`);
  }
  if (model) parts.push(model);
  return (
    <div
      style={{
        fontSize: 9,
        color: 'var(--text-secondary)',
        padding: '4px 0',
        borderTop: '1px solid var(--border)',
        marginTop: 4,
      }}>
      {parts.join(' · ')}
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
