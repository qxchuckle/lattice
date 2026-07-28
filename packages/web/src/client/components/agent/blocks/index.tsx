/**
 * 块渲染组件集 — CC/Codex 风格线性块流
 *
 * 唯一渲染入口 ContentRenderer，直接消费协议 NodeContent（历史与流式同一类型）。
 */
import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NodeContent, TokenUsage } from '@qcqx/lattice-agent-protocol';

// ── 通用折叠容器 ──

function Collapsible({
  label,
  icon,
  status,
  defaultOpen = false,
  children,
}: {
  label: string;
  icon: string;
  status?: 'running' | 'done' | 'error';
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        margin: '4px 0',
        borderRadius: 6,
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          cursor: 'pointer',
          fontSize: 11,
          background: 'var(--bg-tertiary)',
          userSelect: 'none',
        }}>
        <span
          style={{
            fontSize: 10,
            opacity: 0.6,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}>
          ▶
        </span>
        <span>{icon}</span>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--text)',
          }}>
          {label}
        </span>
        {status === 'running' && (
          <span style={{ color: 'var(--brand-color)', fontSize: 10 }}>●</span>
        )}
        {status === 'done' && <span style={{ color: '#52c41a', fontSize: 10 }}>✓</span>}
        {status === 'error' && <span style={{ color: '#ff4d4f', fontSize: 10 }}>✗</span>}
      </div>
      {open && (
        <div style={{ padding: '6px 8px', fontSize: 11, borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

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

function ThinkingBlock({ text }: { text: string }) {
  const lines = text.split('\n').length;
  return (
    <Collapsible label={`Thinking（${lines}行）`} icon='💭'>
      <div
        style={{
          fontStyle: 'italic',
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          fontSize: 11,
        }}>
        {text}
      </div>
    </Collapsible>
  );
}

function ToolCallBlock({ block }: { block: Extract<NodeContent, { type: 'tool_call' }> }) {
  const status =
    block.status === 'success' ? 'done' : block.status === 'error' ? 'error' : 'running';
  return (
    <Collapsible label={block.name} icon='🔧' status={status}>
      <pre
        style={{
          margin: 0,
          fontSize: 10,
          color: 'var(--text-secondary)',
          overflow: 'auto',
          maxHeight: 120,
        }}>
        {JSON.stringify(block.args, null, 2)}
      </pre>
    </Collapsible>
  );
}

function ToolResultBlock({ block }: { block: Extract<NodeContent, { type: 'tool_result' }> }) {
  return (
    <Collapsible
      label={`${block.name} 结果`}
      icon={block.isError ? '❌' : '📋'}
      status={block.isError ? 'error' : 'done'}>
      <pre
        style={{
          margin: 0,
          fontSize: 10,
          color: 'var(--text-secondary)',
          overflow: 'auto',
          maxHeight: 120,
        }}>
        {typeof block.result === 'string' ? block.result : JSON.stringify(block.result, null, 2)}
      </pre>
    </Collapsible>
  );
}

function FileEditBlock({ path, diff }: { path: string; diff: string }) {
  const lines = diff.split('\n').length;
  return (
    <Collapsible label={`${path}（${lines}行变更）`} icon='📝'>
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
      return <ThinkingBlock text={block.text} />;
    case 'tool_call':
      return <ToolCallBlock block={block} />;
    case 'tool_result':
      return <ToolResultBlock block={block} />;
    case 'diff':
      return <FileEditBlock path={block.path} diff={block.text} />;
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
  }
}

/** 渲染一组 NodeContent（历史回复与流式生成共用） */
export function ContentRenderer({
  content,
  streaming,
}: {
  content: NodeContent[];
  streaming?: boolean;
}) {
  return (
    <>
      {content.map((block, i) => (
        <ContentBlockRenderer
          key={i}
          block={block}
          streaming={streaming && i === content.length - 1}
        />
      ))}
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
