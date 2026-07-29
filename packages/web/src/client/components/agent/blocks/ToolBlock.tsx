/**
 * 工具调用卡片 — 一次调用 = 一个视觉单元
 *
 * 视图层按 toolId 配对 call + result（turnSummary.groupToolBlocks），
 * 壳层不认识工具名：图标/形态由 semantic 驱动（源层声明、编排层填充）。
 * subagent 委派走专用卡片（agent 名 + 任务摘要 + 耗时）。
 */
import type { NodeContent, SourceToolSemantic } from '@qcqx/lattice-agent-protocol';
import { Collapsible } from './Collapsible';
import { formatDuration, type ToolGroup } from '../turnSummary';

type ToolCallBlock = Extract<NodeContent, { type: 'tool_call' }>;
type ToolResultBlock = Extract<NodeContent, { type: 'tool_result' }>;

/** semantic → 图标（壳层只认语义，不认工具名） */
const SEMANTIC_ICON: Record<SourceToolSemantic, string> = {
  terminal: '⚡',
  'file-read': '📖',
  'file-write': '📝',
  search: '🔍',
  'code-intel': '🧠',
  subagent: '🤖',
  other: '🔧',
};

/** 从参数提取一行预览（命令/路径/查询等首个字符串值），对齐紧凑单行卡片体验 */
function argsPreview(args: Record<string, unknown>): string {
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.trim()) {
      const line = v.trim().split('\n')[0];
      return line.length > 60 ? `${line.slice(0, 60)}…` : line;
    }
  }
  return '';
}

/** 耗时标注（startedAt/endedAt 来自事件 ts，reload 后不丢） */
function DurationTag({ call }: { call: ToolCallBlock }) {
  if (call.startedAt === undefined || call.endedAt === undefined) return null;
  return (
    <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
      {formatDuration(call.endedAt - call.startedAt)}
    </span>
  );
}

function resultText(result: ToolResultBlock): string {
  if (result.result === undefined) return '';
  return typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
}

/** subagent 委派专用卡片：agent 名 + 任务摘要 + 耗时，展开看返回 */
function SubagentCard({ call, result }: { call: ToolCallBlock; result?: ToolResultBlock }) {
  const status = call.status === 'success' ? 'done' : call.status === 'error' ? 'error' : 'running';
  // Qoder Task 类工具参数约定：subagent_type（agent 名）/ description（任务摘要）
  const agentName = (call.args.subagent_type as string) ?? (call.args.agent as string) ?? call.name;
  const summary = (call.args.description as string) ?? argsPreview(call.args);
  return (
    <Collapsible
      label={`委派 ${agentName}${summary ? ` · ${summary}` : ''}`}
      icon='🤖'
      status={status}
      extra={<DurationTag call={call} />}>
      <pre
        style={{
          margin: 0,
          fontSize: 10,
          color: 'var(--text-secondary)',
          overflow: 'auto',
          maxHeight: 120,
          whiteSpace: 'pre-wrap',
        }}>
        {result ? resultText(result) : JSON.stringify(call.args, null, 2)}
      </pre>
    </Collapsible>
  );
}

/** 普通工具卡片：call + result 合并渲染 */
function ToolCard({ call, result }: { call: ToolCallBlock; result?: ToolResultBlock }) {
  const status = call.status === 'success' ? 'done' : call.status === 'error' ? 'error' : 'running';
  const icon = SEMANTIC_ICON[call.semantic ?? 'other'];
  const preview = argsPreview(call.args);
  const body = result ? resultText(result) : JSON.stringify(call.args, null, 2);
  return (
    <Collapsible
      label={preview ? `${call.name}  ${preview}` : call.name}
      icon={icon}
      status={status}
      extra={<DurationTag call={call} />}>
      <pre
        style={{
          margin: 0,
          fontSize: 10,
          color: 'var(--text-secondary)',
          overflow: 'auto',
          maxHeight: 120,
        }}>
        {body}
      </pre>
    </Collapsible>
  );
}

/** 工具组渲染入口（groupToolBlocks 配对后的产物） */
export function ToolGroupBlock({ group }: { group: ToolGroup }) {
  if (group.call.semantic === 'subagent') {
    return <SubagentCard call={group.call} result={group.result} />;
  }
  return <ToolCard call={group.call} result={group.result} />;
}
