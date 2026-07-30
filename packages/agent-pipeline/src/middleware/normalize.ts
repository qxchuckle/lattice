/**
 * normalize 相位：把宿主意图归一化为源可接受形态
 *
 * 只做「无损或明示降级」的整形，绝不静默丢信息：
 * - 源不接受图片（prompt.images=false）→ 图片块替换为占位文本 + onNotice 回调
 * - systemPrompt 请求按能力落到正确通道（append/override/内联兜底）
 * - thinkingLevel 哨兵值 `'none'`（关闭思考）→ 不传（协议约定：源永不应看到 'none'）
 *   —— 哨兵值存在是为了落盘保留用户选择（retry/continue 复用），归一化属编排层职责
 *
 * middleware 无法自行发事件（事件流在其后才产生），故降级提示走 onNotice 回调，
 * 由宿主决定呈现方式（UI toast / notice 事件 / 日志）。
 */
import type {
  ContentBlock,
  SourceCapabilities,
  SourceMiddleware,
  PromptPayload,
} from '@qcqx/lattice-agent-protocol';
import { applySystemPromptRequest, type SystemPromptRequest } from '../strategies/system-prompt.js';
import { PipelineError } from '../errors.js';

export interface PipelineNotice {
  code: 'images_dropped' | 'system_prompt_inlined' | 'tools_dropped' | 'fork_approximated';
  message: string;
}

export interface NormalizeOptions {
  capabilities: SourceCapabilities;
  /** 降级提示回调（宿主决定呈现方式） */
  onNotice?: (notice: PipelineNotice) => void;
}

/** 关闭思考的哨兵值（客户端表达 + 落盘保留，不得进源） */
const THINKING_OFF = 'none';

/** 图片块 → 占位文本（源不支持图片时；诚实告知模型有图但读不到） */
function stripImages(message: ContentBlock[]): { blocks: ContentBlock[]; dropped: number } {
  let dropped = 0;
  const blocks: ContentBlock[] = [];
  for (const block of message) {
    if (block.type !== 'image') {
      blocks.push(block);
      continue;
    }
    dropped += 1;
    blocks.push({ type: 'text', text: '[图片：当前源不支持图片输入，已省略]' });
  }
  return { blocks, dropped };
}

/**
 * 创建 normalize middleware。
 * systemPrompt 的 inline-fallback 会把附加指令并入消息首块（源不支持 append/override 时）。
 */
export function createNormalizeMiddleware(options: NormalizeOptions): SourceMiddleware {
  const { capabilities: caps, onNotice } = options;
  return {
    name: 'normalize',
    phase: 'normalize',
    async transformPrompt(payload: PromptPayload): Promise<PromptPayload> {
      let message = payload.message;
      let opts = payload.opts;

      // 思考开关哨兵归一化：源看到的要么是有效等级、要么完全缺省
      if (opts.thinkingLevel === THINKING_OFF) {
        const { thinkingLevel: _off, ...rest } = opts;
        opts = rest;
      }

      if (!caps.prompt.images) {
        const { blocks, dropped } = stripImages(message);
        if (dropped > 0) {
          message = blocks;
          onNotice?.({
            code: 'images_dropped',
            message: `当前源不支持图片输入，已省略 ${dropped} 张图片`,
          });
        }
      }

      if (opts.systemPrompt) {
        const req: SystemPromptRequest =
          opts.systemPrompt.mode === 'append'
            ? { kind: 'append', additional: opts.systemPrompt.additional }
            : opts.systemPrompt.mode === 'override'
              ? { kind: 'override', prompt: opts.systemPrompt.prompt }
              : { kind: 'source-default' };
        const applied = applySystemPromptRequest(
          { ...payload, message, opts },
          caps.prompt.systemPrompt,
          req,
        );
        // normalize 是“把宿主意图归一化”的相位：源拒绝意图时必须报错（而非静默丢弃）
        if (applied.rejection) {
          throw PipelineError.unsupportedOption(
            applied.rejection.capabilityPath,
            applied.rejection.reason,
          );
        }
        if (applied.notice) onNotice?.({ code: 'system_prompt_inlined', message: applied.notice });
        message = applied.payload.message;
        opts = applied.payload.opts;
      }

      return message === payload.message && opts === payload.opts
        ? payload
        : { ...payload, message, opts };
    },
  };
}
