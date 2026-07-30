/**
 * Permission Guard — 权限检查（与任务 scopePaths 绑定）
 * 三级权限：allow / ask / deny
 */
import { randomUUID } from 'node:crypto';
import { Subject, firstValueFrom, filter, map, timeout, of, finalize } from 'rxjs';
import type { PermissionLevel, PermissionRequest } from '../types.js';
import type { EventBus } from '../events/event-bus.js';

/** 未应答的权限请求自动拒绝时限（安全默认：不应答即拒绝） */
const PERMISSION_TIMEOUT_MS = 60_000;

export interface PermissionRule {
  /** tool 名称或通配符 '*' */
  tool: string;
  level: PermissionLevel;
  /** 可选：路径前缀匹配（仅对文件操作有效） */
  pathPrefix?: string;
}

export interface ScopeConfig {
  /** 当前任务允许的 scope 路径 */
  scopePaths: string[];
  /** 已注册项目路径（isPathSafe 白名单） */
  safePaths: string[];
}

export class PermissionGuard {
  private rules: PermissionRule[] = [];
  private scope: ScopeConfig = { scopePaths: [], safePaths: [] };
  /** 用户应答流（requestId 关联）；respond → next，requestPermission → filter 对应 id */
  private readonly responses$ = new Subject<{ id: string; allowed: boolean }>();
  /** 待应答请求 id（仅为 respond 保“只处理已知请求”语义；无需再手管 timer/resolve） */
  private readonly pending = new Set<string>();
  private events: EventBus;

  constructor(events: EventBus) {
    this.events = events;

    // 默认规则
    this.rules = [
      { tool: 'readFile', level: 'allow' },
      { tool: 'listDir', level: 'allow' },
      { tool: 'searchFiles', level: 'allow' },
      { tool: 'getTaskContext', level: 'allow' },
      { tool: 'getSpec', level: 'allow' },
      { tool: 'searchHistory', level: 'allow' },
      { tool: 'writeFile', level: 'ask' },
      { tool: 'runCommand', level: 'ask' },
      { tool: 'deleteFile', level: 'deny' },
      { tool: 'forcePush', level: 'deny' },
    ];
  }

  /** 设置当前任务 scope */
  setScope(scope: ScopeConfig): void {
    this.scope = scope;
  }

  /** 设置自定义规则（覆盖默认） */
  setRules(rules: PermissionRule[]): void {
    this.rules = rules;
  }

  /** 检查权限 */
  check(tool: string, args: Record<string, unknown>): PermissionLevel {
    // 1. 路径安全检查
    // args 由模型生成，path/cwd 可能是任意类型：旧实现 `as string` 后调 startsWith 会运行时崩溃。
    // 权限守卫按失败关闭处理——给了路径但类型非法 = 无法校验 = 拒绝。
    const rawPath = args.path ?? args.cwd;
    if (rawPath !== undefined && rawPath !== null && typeof rawPath !== 'string') return 'deny';
    const path = typeof rawPath === 'string' ? rawPath : '';
    if (path && !this.isPathAllowed(path)) return 'deny';

    // 2. 匹配规则（第一条命中即返回）
    for (const rule of this.rules) {
      if (rule.tool === tool || rule.tool === '*') {
        if (rule.pathPrefix && !path.startsWith(rule.pathPrefix)) continue;
        return rule.level;
      }
    }

    // 3. 默认 ask
    return 'ask';
  }

  /** 请求用户授权（异步等待响应） */
  async requestPermission(tool: string, args: Record<string, unknown>): Promise<boolean> {
    const level = this.check(tool, args);
    if (level === 'allow') return true;
    if (level === 'deny') return false;

    // level === 'ask' → 发事件等用户响应
    const request: PermissionRequest = {
      id: randomUUID(),
      tool,
      args,
      level,
      timestamp: Date.now(),
    };

    // 先订阅后 emit：firstValueFrom 同步订阅 responses$，确保同进程监听器/自动策略在
    // emit 期间的同步 respond 不会落空（反向通道接入时暴露的真实竞态）。
    // timeout 代替手写 setTimeout：未应答自动归为 false（安全默认）；finalize 统一清理 pending。
    this.pending.add(request.id);
    const answered = firstValueFrom(
      this.responses$.pipe(
        filter((r) => r.id === request.id),
        map((r) => r.allowed),
        timeout({ each: PERMISSION_TIMEOUT_MS, with: () => of(false) }),
        finalize(() => this.pending.delete(request.id)),
      ),
    );
    this.events.emit('permission:request', { request });
    return answered;
  }

  /** 用户响应权限请求（仅处理已知待应答请求，同旧版） */
  respond(requestId: string, allowed: boolean): void {
    if (!this.pending.has(requestId)) return;
    this.responses$.next({ id: requestId, allowed });
    this.events.emit('permission:response', { requestId, allowed });
  }

  /** 路径是否在允许范围内 */
  private isPathAllowed(path: string): boolean {
    // 无 scope 配置时默认允许（向后兼容）
    if (this.scope.safePaths.length === 0 && this.scope.scopePaths.length === 0) return true;

    const normalized = path.replace(/\\/g, '/');
    return (
      this.scope.safePaths.some((p) => normalized.startsWith(p)) ||
      this.scope.scopePaths.some((p) => normalized.startsWith(p))
    );
  }
}
