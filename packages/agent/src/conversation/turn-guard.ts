/**
 * TurnGuard — 命令守卫与能力下发的单一入口
 *
 * 「接口行为 ≡ 视图」的落点：同一个 `projectTurnCapabilities` 既产出下发给 client 的能力，
 * 又用于 server 侧命令入口的准入判定。能力投影包含源能力维度（fork）：
 * 线程源不支持分叉时，branch/retry 在两侧同时消失。
 *
 * ── 两层语义（重要） ──
 * `NodeCapabilities` 里存在两类字段，守卫只能用前者：
 * - **准入（permission）**：canUndo / canDelete / canBranch / canFollowup / canAbort
 *   —— 回答“该操作是否允许”（只读终态、流式中、源 fork 能力）
 * - **呈现（affordance）**：canRetry / canContinue
 *   —— 回答“UI 何时把按钮放出来”（仅 error / interrupted 才提示重试与继续）
 *
 * 直接拿呈现字段做守卫会误杀合法调用（如对正常回复“重新生成”、对错误轮次“继续”），
 * 故下方把每个操作映射到明确的**准入**谓词；不比视图宽（UI 能点的接口必允许），
 * 也不把呈现保守当成接口禁令。
 */
import type {
  ConversationNode,
  ForkCapability,
  NodeCapabilities,
  NodeOperation,
} from '@qcqx/lattice-agent-protocol';
import { projectTurnCapabilities } from '@qcqx/lattice-agent-protocol';
import type { ConversationControllerDeps } from './types.js';
import type { TreeOps } from './tree-ops.js';

/** turn 级能力表：turnId（user 节点 ID）→ 能力 */
export type TurnCapabilityMap = Record<string, NodeCapabilities>;

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** 操作 → 拒绝文案（用户可见，故与操作语义一一对应） */
const REJECT_REASON: Record<NodeOperation, string> = {
  continue: '该回复不可继续（节点已撤销/删除或正在生成）',
  retry: '该消息不可重试（已撤销/删除、正在生成，或线程源不支持分叉）',
  undo: '该节点已处于只读终态，撤销无效',
  delete: '该节点已删除，重复删除无效',
};

/**
 * 操作 → 准入谓词（只用 permission 类字段，不用 affordance）。
 * `Record<NodeOperation, ...>` 保证新增操作时编译期强制补全判定。
 * 导出供不变量测试穷举验证：呈现为真 ⇒ 准入必为真（UI 放出的按钮接口不得拒）。
 */
export const PERMITS: Record<NodeOperation, (caps: NodeCapabilities) => boolean> = {
  // 继续：非只读且非流式中即可（error 轮次也允许继续，UI 仅在 interrupted 时提示）
  continue: (caps) => caps.canFollowup && !caps.canAbort,
  // 重试（重新生成）：与分支同权 —— 非只读 + 非流式 + 源支持 fork
  retry: (caps) => caps.canBranch,
  undo: (caps) => caps.canUndo,
  delete: (caps) => caps.canDelete,
};

export class TurnGuard {
  constructor(
    private readonly deps: ConversationControllerDeps,
    private readonly tree: TreeOps,
  ) {}

  /** 该 turn 所属线程源的 fork 能力（未握手/未注册时按宽松处理，不误禁用户操作） */
  private forkCapabilityOf(treeId: string, turnId: string): ForkCapability {
    const sourceId = this.tree.resolveNodeSourceId(treeId, turnId);
    const caps = sourceId ? this.deps.profiles.get(sourceId)?.capabilities : undefined;
    return caps?.session.fork ?? { atMessage: true };
  }

  /** 取该 turn 的 assistant 子节点（retry 后可能多个，取非只读的活跃者） */
  private assistantOf(treeId: string, turnId: string): ConversationNode | undefined {
    return this.deps.session.getActiveAssistantChild(treeId, turnId);
  }

  /**
   * 该 turn 是否位于线程末尾（其 assistant 节点无活跃后代）。
   *
   * 用于传给能力投影：`fork.atMessage=false` 的源（如 ACP）只能从末尾分叉，
   * 中间节点的 branch/retry 必须在两侧（UI 与接口）同时不可用。
   */
  private isTail(treeId: string, turnId: string): boolean {
    const assistant = this.assistantOf(treeId, turnId);
    if (!assistant) return true; // 还没回复 = 末尾
    const nodes = this.deps.session.getNodes(treeId);
    return !nodes.some(
      (n) => n.parentId === assistant.id && n.status !== 'undone' && n.status !== 'hidden',
    );
  }

  /** 单个 turn 的能力（server 命令守卫与 client 渲染共用的同一判定） */
  capabilitiesOf(treeId: string, turnId: string): NodeCapabilities | undefined {
    const userNode = this.deps.session.getNode(treeId, turnId);
    if (!userNode) return undefined;
    return projectTurnCapabilities(userNode, this.assistantOf(treeId, turnId), {
      fork: this.forkCapabilityOf(treeId, turnId),
      isTail: this.isTail(treeId, turnId),
    });
  }

  /**
   * 全树 turn 能力表（随 wire 快照下发；派生数据不落盘）。
   * 仅 user 节点成 turn：assistant 是 turn 的一部分，不单独持有操作入口。
   */
  capabilitiesOfTree(treeId: string): TurnCapabilityMap {
    const map: TurnCapabilityMap = {};
    for (const node of this.deps.session.getNodes(treeId)) {
      if (node.role !== 'user') continue;
      const caps = this.capabilitiesOf(treeId, node.id);
      if (caps) map[node.id] = caps;
    }
    return map;
  }

  /** 命令准入：与下发给 UI 的能力同源，故 UI 置灰的结构操作在接口侧同样被拒 */
  check(treeId: string, turnId: string, op: NodeOperation): GuardResult {
    const caps = this.capabilitiesOf(treeId, turnId);
    if (!caps) return { ok: false, reason: '节点不存在' };
    return PERMITS[op](caps) ? { ok: true } : { ok: false, reason: REJECT_REASON[op] };
  }
}
