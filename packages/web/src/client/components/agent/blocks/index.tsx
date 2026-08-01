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
import { assertNever } from '@qcqx/lattice-agent-protocol';
import { groupToolBlocks } from '../turnSummary';
import { Collapsible } from './Collapsible';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolGroupBlock } from './ToolBlock';
import { BLOCK_RENDERERS, registerBlockRenderer, sealBuiltinTypes } from './registry';
import { useBatchedBlocks } from './useBatchedBlocks';
import { BLOCK_STYLE } from '../../../constants/layout';

export { FileChangeSummary } from './FileChangeSummary';

// ── 流式块渲染 ──

function TextBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div
      className='agent-md-block'
      style={{
        ...BLOCK_STYLE.text,
        color: 'var(--text)',
        wordBreak: 'break-word',
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
          ...BLOCK_STYLE.copyButton,
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
          ...BLOCK_STYLE.codeBlockPre,
          background: 'var(--bg-tertiary)',
          overflow: 'auto',
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
        <pre style={{ ...BLOCK_STYLE.diffPre, overflow: 'auto' }}>
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
            ...BLOCK_STYLE.terminalPre,
            color: 'var(--text-secondary)',
            overflow: 'auto',
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
        ...BLOCK_STYLE.errorBox,
        borderLeft: '3px solid #ff4d4f',
        background: 'rgba(255,77,79,0.06)',
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
    <div style={{ ...BLOCK_STYLE.compactionBox }}>
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
              ...BLOCK_STYLE.diffPre,
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
        ...BLOCK_STYLE.noticeBox,
        borderLeft: `3px solid ${color}`,
        background: level === 'warning' ? 'rgba(250,173,20,0.06)' : 'var(--bg-tertiary)',
        color,
      }}>
      {level === 'warning' ? '⚠ ' : ''}
      {text}
    </div>
  );
}

// ── 渲染器注册（替代旧 switch 分发） ──
// 新增块类型只需 registerBlockRenderer 注册一项，无需改 ContentBlockRenderer。
registerBlockRenderer('text', ({ block, streaming }) => (
  <TextBlock text={(block as { text: string }).text} streaming={streaming} />
));
registerBlockRenderer('code', ({ block }) => {
  const b = block as { text: string };
  return (
    <pre
      style={{
        ...BLOCK_STYLE.code,
        background: 'var(--bg-tertiary)',
        overflow: 'auto',
      }}>
      {b.text}
    </pre>
  );
});
registerBlockRenderer('thinking', ({ block, streaming }) => {
  const b = block as { text: string; startedAt?: number; endedAt?: number };
  return (
    <ThinkingBlock text={b.text} startedAt={b.startedAt} endedAt={b.endedAt} active={streaming} />
  );
});
registerBlockRenderer('diff', ({ block }) => {
  const b = block as { path: string; text?: string; kind?: 'create' | 'edit' | 'delete' };
  return <FileEditBlock path={b.path} diff={b.text} kind={b.kind} />;
});
registerBlockRenderer('image', ({ block }) => {
  const b = block as { data: string; mimeType: string };
  return (
    <img
      src={`data:${b.mimeType};base64,${b.data}`}
      alt='image'
      style={{ maxWidth: '100%', borderRadius: 4, margin: '4px 0' }}
    />
  );
});
registerBlockRenderer('terminal', ({ block }) => {
  const b = block as { command: string; output?: string };
  return <TerminalBlock command={b.command} output={b.output} />;
});
registerBlockRenderer('error', ({ block }) => {
  const b = block as { message: string; suggestion?: string };
  return <ErrorBlock message={b.message} suggestion={b.suggestion} />;
});
registerBlockRenderer('compaction', ({ block }) => {
  const b = block as { trigger: 'auto' | 'manual'; preTokens?: number; summary?: string };
  return <CompactionBlock trigger={b.trigger} preTokens={b.preTokens} summary={b.summary} />;
});
registerBlockRenderer('notice', ({ block }) => {
  const b = block as { level: 'info' | 'warning'; text: string };
  return <NoticeBlock level={b.level} text={b.text} />;
});
// tool_call / tool_result 已由 groupToolBlocks 配对为 tool-group 卡片（ContentRenderer 分支）；
// 此处仅处理孤儿块，无独立视觉（保持既有行为：不渲染）
registerBlockRenderer('tool_call', () => null);
registerBlockRenderer('tool_result', () => null);

// 封存内置类型：后续外部 registerBlockRenderer 不可覆盖以上内置渲染器
sealBuiltinTypes();

/**
 * 内容块渲染器：查注册表渲染，未注册类型走 assertNever 兜底。
 * 新增块类型只需在上方 registerBlockRenderer 注册一项。
 */
export function ContentBlockRenderer({
  block,
  streaming,
}: {
  block: NodeContent;
  streaming?: boolean;
}) {
  const renderer = BLOCK_RENDERERS.get(block.type);
  if (renderer) {
    return renderer({ block, streaming });
  }
  // exhaustiveness 兜底：注册表模式为动态扩展，失去 switch 的编译期穷举性检查；
  // 此处仍用 assertNever 保持运行时兜底语义（未注册类型抛错，不静默丢弃）
  return assertNever(block as never);
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
  // 批次四：100+ 块场景分批渲染，避免一次性挂载大量 DOM
  const visibleBlocks = useBatchedBlocks(renderBlocks, streaming);
  return (
    <>
      {visibleBlocks.map((block, i) => {
        const isLast = i === visibleBlocks.length - 1;
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
        ...BLOCK_STYLE.usageFooter,
        color: 'var(--text-secondary)',
        borderTop: '1px solid var(--border)',
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
