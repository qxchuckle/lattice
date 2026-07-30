/**
 * 源权限请求 → PermissionGuard（反向通道的 lattice 接线）
 *
 * 分工：pipeline 提供机制（规则匹配 / session 记账 / 审计），本文件提供 lattice 策略——
 * PermissionGuard 自带规则表（tool/pathPrefix → allow|deny|ask）与 UI 问询流
 * （emit `permission:request` → 等 `respond()`，60s 超时拒绝），故 gate 只需把 ask 委派给它。
 *
 * 现状：pi 是 local 模式、qoder 用 permissionMode 一刀切，二者都不走本通道；
 * 接线在此先立，ACP driver（session/request_permission）落地即生效。
 */
import type { PermissionRequestHandler } from '@qcqx/lattice-agent-protocol';
import { createPermissionGate } from '@qcqx/lattice-agent-pipeline';
import type { PermissionGuard } from './permission-guard.js';

export function createSourcePermissionHandler(guard: PermissionGuard): PermissionRequestHandler {
  return createPermissionGate({
    // 规则判定与问询都在 guard 内部（check → allow/deny/ask），故此处全量委派
    fallback: 'ask',
    ask: async (req) => {
      // 工具名缺省时用请求种类作标识（file-write/terminal 等），保证规则表可命中
      const subject = req.toolName ?? req.kind;
      const allowed = await guard.requestPermission(subject, req.detail ?? {});
      return allowed
        ? { behavior: 'allow', scope: 'once' }
        : { behavior: 'deny', scope: 'once', message: '用户或权限策略拒绝了该操作' };
    },
  });
}
