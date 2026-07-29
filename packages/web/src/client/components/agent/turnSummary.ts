/**
 * turnSummary — 回合内容派生纯函数（可测试，不碰 store）
 *
 * 与 turnGraph.ts 同款定位：client 数据逻辑抽为纯函数模块，组件只做薄壳。
 * 这里负责两件事：
 *   1. groupToolBlocks：一次工具调用 = 一个视觉单元（call + result 视图层配对）
 *   2. collectFileChanges：回合末「本轮改动 N 个文件」汇总
 * 以及耗时格式化 formatDuration。
 */
import type { NodeContent } from '@qcqx/lattice-agent-protocol';

type ToolCallBlock = Extract<NodeContent, { type: 'tool_call' }>;
type ToolResultBlock = Extract<NodeContent, { type: 'tool_result' }>;

/** 配对后的工具调用渲染项（call + 可选 result 合并为一个视觉单元）
 * type: 'tool-group' 不在 NodeContent 的 type 联合中，可作为判别字段 narrow */
export interface ToolGroup {
  type: 'tool-group';
  call: ToolCallBlock;
  result?: ToolResultBlock;
}

/** 渲染序列项：普通内容块 或 配对后的工具组 */
export type RenderBlock = NodeContent | ToolGroup;

/**
 * 把 tool_result 按 toolId 折进对应的 tool_call，渲染时一次调用只占一个卡片。
 * 落盘格式不变（blocks 里仍有独立 tool_result 块），仅视图层配对——
 * 历史 JSONL 全兼容，且流式期间 result 未到时 call 卡片照常显示 running。
 */
export function groupToolBlocks(blocks: NodeContent[]): RenderBlock[] {
  const out: RenderBlock[] = [];
  // toolId → 已入列的 tool_call 块（供 result 到达时回填配对）
  const callByToolId = new Map<string, ToolGroup>();
  for (const block of blocks) {
    if (block.type === 'tool_call') {
      const group: ToolGroup = { type: 'tool-group', call: block };
      callByToolId.set(block.toolId, group);
      out.push(group);
    } else if (block.type === 'tool_result') {
      const group = callByToolId.get(block.toolId);
      if (group) {
        group.result = block;
      } else {
        // 孤儿 result（call 块缺失的兜底）：原样保留渲染
        out.push(block);
      }
    } else {
      out.push(block);
    }
  }
  return out;
}

/** 回合内单个文件的改动汇总项 */
export interface FileChangeItem {
  path: string;
  /** 操作类型（源层映射；缺失时按「编辑」呈现） */
  kind?: 'create' | 'edit' | 'delete';
  /** 同一路径被改动的次数 */
  count: number;
}

/**
 * 从回合块流聚合「本轮改动的文件」，两阶段避免重复计数：
 *   1. diff 块（源层 file_edit 事件落盘）为权威数据源
 *   2. semantic === 'file-write' 的 tool_call 块仅兜底补 diff 未覆盖的路径
 *      （源层会对同一文件同时产出 tool_call + file_edit，单趟会同文件计两次）
 * 按路径去重合并，保持首次出现顺序。
 */
export function collectFileChanges(blocks: NodeContent[]): FileChangeItem[] {
  const byPath = new Map<string, FileChangeItem>();
  const bump = (path: string, kind?: 'create' | 'edit' | 'delete'): void => {
    const item = byPath.get(path);
    if (item) {
      item.count++;
    } else {
      byPath.set(path, { path, ...(kind ? { kind } : {}), count: 1 });
    }
  };
  // 阶段 1：diff 块（权威）
  for (const block of blocks) {
    if (block.type === 'diff') bump(block.path, block.kind);
  }
  // 阶段 2：file-write tool_call 兜底（仅补 diff 未覆盖的路径；kind 不推断，壳层不认工具名）
  for (const block of blocks) {
    if (block.type === 'tool_call' && block.semantic === 'file-write') {
      const p = extractPathFromArgs(block.args);
      if (p && !byPath.has(p)) bump(p);
    }
  }
  return [...byPath.values()];
}

/** 从工具参数提取文件路径（仅兜底分支使用，兼容两源参数命名） */
function extractPathFromArgs(args: Record<string, unknown>): string | undefined {
  const p = args.path ?? args.file_path ?? args.filePath;
  return typeof p === 'string' && p ? p : undefined;
}

/**
 * 耗时格式化：<1s 显示毫秒，<60s 显示秒（一位小数），≥60s 显示 1m2s
 * 思考块 / 工具卡片 / 流式实时计时共用，避免各处格式不一致
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}
