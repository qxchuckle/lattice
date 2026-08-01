/**
 * fork 策略表：能力形态 → 执行计划
 *
 * 「减少 if/else」的类型学解法：`Record<ForkShape, Planner>` 穷尽表——
 * ForkCapability 新增形态时，本表缺项即编译报错，而不是运行时走进兜底 else。
 *
 * 铁律：源永不静默降级。锚点被丢弃（源不支持 atMessage）时计划里带 notice，
 * 由宿主决定「照做并提示」还是「拒绝」——降级是编排层特权，不是源的。
 */
import { assertNever } from '@qcqx/lattice-agent-protocol';
import type { ForkCapability, ISource } from '@qcqx/lattice-agent-protocol';
import { PipelineError } from '../errors.js';

/** 能力形态判别（把 `{atMessage} | false` 收成字面量，供穷尽表索引） */
export type ForkShape = 'at-message' | 'session-only' | 'none';

export function forkShape(cap: ForkCapability): ForkShape {
  if (cap === false) return 'none';
  return cap.atMessage ? 'at-message' : 'session-only';
}

export interface ForkRequest {
  sessionId: string;
  /** 期望的截断锚点（源侧消息 ID）；缺省 = 从会话末端分叉 */
  atMessage?: string;
}

export type ForkPlan =
  /** 精确执行：能力满足请求 */
  | { kind: 'precise'; sessionId: string; atMessage?: string }
  /** 近似执行：锚点被丢弃，分叉包含锚点之后的消息（宿主须呈现 notice） */
  | { kind: 'whole-session'; sessionId: string; droppedAnchor: string; notice: string }
  /** 不可执行：源无 fork 能力（宿主应在 UI/接口层已门控，此处为纵深防御） */
  | { kind: 'unsupported'; capabilityPath: 'session.fork'; reason: string };

const FORK_PLANNERS: Record<ForkShape, (req: ForkRequest) => ForkPlan> = {
  'at-message': (req) => ({
    kind: 'precise',
    sessionId: req.sessionId,
    atMessage: req.atMessage,
  }),
  'session-only': (req) =>
    req.atMessage === undefined
      ? // 无锚点需求 → 整会话 fork 即精确语义
        { kind: 'precise', sessionId: req.sessionId }
      : {
          kind: 'whole-session',
          sessionId: req.sessionId,
          droppedAnchor: req.atMessage,
          notice: '该源不支持按消息锚点分叉，已从会话末端整体分叉（分支包含锚点之后的消息）',
        },
  none: () => ({
    kind: 'unsupported',
    capabilityPath: 'session.fork',
    reason: '该源不支持会话分叉',
  }),
};

export function planFork(cap: ForkCapability, req: ForkRequest): ForkPlan {
  return FORK_PLANNERS[forkShape(cap)](req);
}

export interface ForkExecution {
  newSessionId: string;
  /** 近似执行的提示文案（宿主转成 notice 事件 / UI 提示）；精确执行时为空 */
  notices: string[];
}

/**
 * 执行计划。unsupported 计划抛 PipelineError——调用方本应先用投影门控，
 * 走到这里说明绕过了门控（如直接请求接口），行为与视图一致地拒绝。
 */
export async function executeForkPlan(source: ISource, plan: ForkPlan): Promise<ForkExecution> {
  switch (plan.kind) {
    case 'precise': {
      const newSessionId = await source.forkSession(plan.sessionId, plan.atMessage);
      return { newSessionId, notices: [] };
    }
    case 'whole-session': {
      const newSessionId = await source.forkSession(plan.sessionId);
      return { newSessionId, notices: [plan.notice] };
    }
    case 'unsupported':
      throw PipelineError.unsupported(plan.capabilityPath, plan.reason, source.id);
    default:
      // exhaustiveness 兜底：ForkPlan 新增 kind 而本 switch 未补 → 编译报错；运行时触达即抛错
      assertNever(plan);
  }
}
