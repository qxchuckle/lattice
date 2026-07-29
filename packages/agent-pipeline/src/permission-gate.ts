/**
 * 权限闸门：把「声明式策略」编译成 onPermissionRequest 回调
 *
 * 这是三层机制在反向通道上的落点——权限不是 middleware 能拦的（事件流之外的问答），
 * 故单独提供机制：pipeline 管**怎么裁决**（规则匹配 + session 记账 + 审计），
 * 宿主管**裁决什么**（规则表由 lattice/CLI/ACP gateway 各自给）。
 *
 * 铁律：
 * - 无规则命中且无 ask 回调 → deny 并说明原因（默认拒绝，不默认放行）
 * - scope:'session' 的裁决被记账，同类请求不再重复问（源不必自己记）
 */
import type {
  SourcePermissionRequest,
  PermissionDecision,
  PermissionRequestHandler,
} from '@qcqx/lattice-agent-protocol';

/** 规则：字段全部可选，省略即「不限」；首个命中的规则生效 */
export interface PermissionRule {
  kind?: SourcePermissionRequest['kind'];
  /** 工具名精确匹配（kind=tool 时有意义） */
  toolName?: string;
  decision: PermissionDecision;
}

export interface PermissionGateOptions {
  /** 顺序匹配的规则表 */
  rules?: readonly PermissionRule[];
  /** 无规则命中时：'ask' 交互问询（需 ask 回调）/ 'deny' 直接拒绝（缺省） */
  fallback?: 'ask' | 'deny';
  /** fallback='ask' 时的交互回调（宿主 UI）；未提供则退化为 deny */
  ask?: PermissionRequestHandler;
  /** 审计钩子：每次裁决都回调（宿主写日志/落盘/呈现） */
  onDecision?: (req: SourcePermissionRequest, decision: PermissionDecision, via: string) => void;
}

function matches(rule: PermissionRule, req: SourcePermissionRequest): boolean {
  if (rule.kind !== undefined && rule.kind !== req.kind) return false;
  if (rule.toolName !== undefined && rule.toolName !== req.toolName) return false;
  return true;
}

/** session 记账键：同会话 + 同类 + 同工具视为「同类请求」 */
function memoKey(req: SourcePermissionRequest): string {
  return `${req.sessionId}\u0000${req.kind}\u0000${req.toolName ?? ''}`;
}

export function createPermissionGate(
  options: PermissionGateOptions = {},
): PermissionRequestHandler {
  const rules = options.rules ?? [];
  const fallback = options.fallback ?? 'deny';
  const remembered = new Map<string, PermissionDecision>();

  return async (req) => {
    const key = memoKey(req);
    const decide = (decision: PermissionDecision, via: string): PermissionDecision => {
      if (decision.scope === 'session') remembered.set(key, decision);
      options.onDecision?.(req, decision, via);
      return decision;
    };

    const memo = remembered.get(key);
    if (memo) {
      options.onDecision?.(req, memo, 'session-memo');
      return memo;
    }

    const index = rules.findIndex((rule) => matches(rule, req));
    if (index >= 0) return decide(rules[index].decision, `rule#${index}`);

    if (fallback === 'ask' && options.ask) {
      return decide(await options.ask(req), 'ask');
    }
    return decide(
      {
        behavior: 'deny',
        scope: 'once',
        message:
          fallback === 'ask' ? '宿主未提供权限问询通道，按默认拒绝处理' : '宿主策略未授权该操作',
      },
      'fallback-deny',
    );
  };
}
