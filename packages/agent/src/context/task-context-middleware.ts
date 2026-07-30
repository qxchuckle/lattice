/**
 * 任务上下文注入 middleware（lattice 专属「价值类」拦截）
 *
 * 把当前线程关联任务的 PRD / 相关 spec / 最近进展注入 system prompt——
 * 这是 lattice 的本业（跨项目上下文管理），故留在 agent 包而非 pipeline。
 *
 * 行为约定：
 * - 线程无关联任务（tree.taskId 缺省）→ 原样返回，不注入（未配置任务时行为与无本 middleware 一致）
 * - ContextSource 未注入（engine.setSource 未调用）→ buildContext 返回空层，同样不注入
 * - 落法交给 pipeline 的 systemPrompt 策略表：源不支持 append/override 时并入消息正文
 */
import type {
  SourceCapabilities,
  SourceMiddleware,
  PromptPayload,
  MiddlewareContext,
} from '@qcqx/lattice-agent-protocol';
import { injectSystemPromptAddition } from '@qcqx/lattice-agent-pipeline';
import type { ContextEngine } from './context-engine.js';

/** ctx.metadata 里的任务标识键（controller 按线程写入） */
export const TASK_ID_METADATA_KEY = 'taskId';

export interface TaskContextMiddlewareDeps {
  engine: ContextEngine;
  capabilities: SourceCapabilities;
  /** 注入被降级为消息正文时的提示（宿主呈现） */
  onNotice?: (message: string) => void;
}

function taskIdOf(ctx: MiddlewareContext): string | undefined {
  const value = ctx.metadata?.[TASK_ID_METADATA_KEY];
  return typeof value === 'string' && value ? value : undefined;
}

export function createTaskContextMiddleware(deps: TaskContextMiddlewareDeps): SourceMiddleware {
  return {
    name: 'lattice-task-context',
    phase: 'inject',
    async transformPrompt(payload, ctx): Promise<PromptPayload> {
      const taskId = taskIdOf(ctx);
      if (!taskId) return payload;

      const built = await deps.engine.buildContext({ taskId, model: payload.opts.model });
      if (built.layers.length === 0) return payload;

      // 落法（append / override / 内联兜底）统一走 pipeline 策略层，本文件不重复决策
      const applied = injectSystemPromptAddition(
        payload,
        deps.capabilities.prompt.systemPrompt,
        built.systemPrompt,
      );
      if (applied.notice) deps.onNotice?.(applied.notice);
      // 任务上下文是增强而非必需：源拒绝时跳过，不阻断本轮对话
      return applied.payload;
    },
  };
}
