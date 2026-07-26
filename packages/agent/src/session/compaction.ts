/**
 * Compaction — 对话压缩（参考 Claude Code auto-compaction + Pi 内置 compaction）
 *
 * 核心原则：
 * - 压缩失败（无网络/LLM 不可用）→ 告知用户失败，不静默降级截断
 * - 压缩前关键信息应已持久化为 lattice checkpoint（互补机制）
 * - 被压缩节点标记 compacted=true，加载时用 aggregation 摘要替代
 */
import type { ConversationNode, NodeContent } from '../types.js';

// ── 接口 ──

export interface CompactionOptions {
  /** 保留最近 N 个节点不压缩（默认 20） */
  keepRecent?: number;
  /** 压缩时的关注点提示（传给 LLM） */
  focus?: string;
  /** 只压缩指定分支的节点（不传则压缩所有分支） */
  branchId?: string;
}

export interface CompactionResult {
  /** AI 生成的摘要文本 */
  summary: string;
  /** 被压缩的节点 ID 列表 */
  compactedNodeIds: string[];
  /** 摘要节点（role=aggregation，追加到 JSONL） */
  summaryNode: ConversationNode;
}

/**
 * 摘要生成函数签名
 * 由调用方注入 LLM 能力（agent-core 或外部 provider）
 * 失败时应 throw Error，compaction 层不 catch（让调用方决定如何告知用户）
 */
export type SummarizeFn = (opts: {
  messages: Array<{ role: string; content: string }>;
  focus?: string;
}) => Promise<string>;

// ── 核心逻辑 ──

/**
 * 执行对话压缩
 *
 * @param nodes - 当前树的全部节点（已按 timestamp 排序）
 * @param opts - 压缩选项
 * @param summarize - LLM 摘要生成函数（失败时 throw，不降级）
 * @param createNode - 创建摘要节点的回调（由 SessionManager 提供）
 * @returns CompactionResult
 * @throws Error 当 LLM 不可用/调用失败时（调用方负责告知用户）
 */
export async function compactConversation(
  nodes: ConversationNode[],
  opts: CompactionOptions,
  summarize: SummarizeFn,
  createNode: (content: NodeContent[], compactedFrom: string[]) => Promise<ConversationNode>,
): Promise<CompactionResult> {
  const keepRecent = opts.keepRecent ?? 20;

  // 按时间排序
  const sorted = [...nodes].sort((a, b) => a.timestamp - b.timestamp);

  // 筛选可压缩节点（排除已压缩的、排除最近 N 条）
  let candidates = sorted.filter((n) => !n.metadata?.compacted && n.role !== 'aggregation');
  if (opts.branchId) {
    candidates = candidates.filter((n) => n.branchId === opts.branchId);
  }

  if (candidates.length <= keepRecent) {
    // 节点数不够，无需压缩
    return {
      summary: '',
      compactedNodeIds: [],
      summaryNode: null as unknown as ConversationNode,
    };
  }

  // 分割：要压缩的 vs 保留的
  const toCompact = candidates.slice(0, candidates.length - keepRecent);
  const compactedNodeIds = toCompact.map((n) => n.id);

  // 构建 LLM 输入
  const messages = toCompact.map((n) => ({
    role: n.role,
    content: n.content
      .map((c) => c.text ?? '')
      .join('\n')
      .slice(0, 2000), // 每条最多 2000 字符，避免 token 爆炸
  }));

  // 调用 LLM 生成摘要（失败时 throw，不 catch）
  const summary = await summarize({ messages, focus: opts.focus });

  // 创建摘要节点
  const summaryContent: NodeContent[] = [
    {
      type: 'text',
      text: `[对话压缩摘要]\n${summary}`,
    },
  ];

  const summaryNode = await createNode(summaryContent, compactedNodeIds);

  return { summary, compactedNodeIds, summaryNode };
}

/**
 * 判断是否需要压缩（节点数超过阈值）
 */
export function shouldCompact(nodes: ConversationNode[], threshold = 100): boolean {
  const activeNodes = nodes.filter((n) => !n.metadata?.compacted && n.role !== 'aggregation');
  return activeNodes.length > threshold;
}

/**
 * 过滤已压缩节点（加载时使用）
 * 返回：摘要节点 + 未压缩节点（按时间排序）
 */
export function filterCompactedNodes(nodes: ConversationNode[]): ConversationNode[] {
  return nodes.filter((n) => !n.metadata?.compacted).sort((a, b) => a.timestamp - b.timestamp);
}
