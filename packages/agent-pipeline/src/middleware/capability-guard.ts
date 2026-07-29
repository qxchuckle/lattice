/**
 * guard 相位：能力守卫（纵深防御的最后一道）
 *
 * 唯一职责：把「声明层禁止的调用」在进源之前拦下，抛类型化 PipelineError。
 * 宿主的 UI 与接口共用本 middleware → 绕过 UI 直请接口时行为与视图一致。
 *
 * 不做降级、不改内容（那是 normalize/expand/inject 的事）——纯判定。
 */
import type {
  SourceCapabilities,
  SourceMiddleware,
  PromptPayload,
  ModelInfo,
} from '@qcqx/lattice-agent-protocol';
import { validateModel, planToolInjection } from '../strategies/models.js';
import { PipelineError } from '../errors.js';
import type { PipelineNotice } from './normalize.js';

export interface CapabilityGuardOptions {
  capabilities: SourceCapabilities;
  /** 模型目录（catalog 策略校验用）；缺省或空 = 目录未就绪，跳过校验 */
  catalog?: ModelInfo[];
  /** tools 送不进去时的丢弃提示 */
  onNotice?: (notice: PipelineNotice) => void;
}

export function createCapabilityGuardMiddleware(options: CapabilityGuardOptions): SourceMiddleware {
  const caps = options.capabilities;
  return {
    name: 'capability-guard',
    phase: 'guard',
    async transformPrompt(payload: PromptPayload): Promise<PromptPayload> {
      const { opts } = payload;
      let next = opts;

      // 模型：catalog 策略下不在目录内即拒绝（与 UI 下拉可选项同一判定）
      if (opts.model) {
        const validation = validateModel(caps.models, opts.model, options.catalog ?? []);
        if (!validation.ok) {
          throw PipelineError.unsupportedOption(validation.capabilityPath, validation.reason);
        }
      }

      // 权限模式：取值必须在声明清单内
      if (opts.permissionMode !== undefined) {
        const modes = caps.prompt.permissionModes;
        if (modes === false) {
          throw PipelineError.unsupportedOption(
            'prompt.permissionModes',
            '该源没有权限模式轴，不接受 permissionMode',
          );
        }
        if (!modes.available.includes(opts.permissionMode)) {
          throw PipelineError.unsupportedOption(
            'prompt.permissionModes',
            `该源不支持权限模式 "${opts.permissionMode}"（可用：${modes.available.join(' / ')}）`,
          );
        }
      }

      // 图片：normalize 之后仍存在 = 装配缺失或调用绕过管线（纵深防御）
      if (!caps.prompt.images && payload.message.some((b) => b.type === 'image')) {
        throw PipelineError.unsupportedOption('prompt.images', '该源不接受图片输入');
      }

      // 宿主工具：注入通道不存在则丢弃并提示（丢弃是编排层决定，不静默）
      if (opts.tools && opts.tools.tools.length > 0) {
        const plan = planToolInjection(caps.tools.injection);
        if (plan.kind === 'drop') {
          const { tools: _dropped, ...rest } = next;
          next = rest;
          options.onNotice?.({ code: 'tools_dropped', message: plan.notice });
        }
      }

      return next === opts ? payload : { ...payload, opts: next };
    },
  };
}
