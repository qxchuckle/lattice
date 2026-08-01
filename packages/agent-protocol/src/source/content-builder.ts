/**
 * 事件 → 内容转换的唯一实现
 *
 * 统一此前散落多处的转换逻辑：
 *   - server 批量 buildPersistData（流结束整体转换）
 *   - server 增量 runningContent（每 delta 维护，供 streaming 文件）
 *   - client 流式块累积（实时渲染，直接作用于 valtio proxy 数组）
 *
 * 两个层次：
 *   applyEventToContent(content, event) — 纯内容累积（client/server 共用）
 *   StreamAccumulator — 内容 + 持久化元数据（toolCalls/fileChanges/done，server 用）
 */
import type { SourceEvent, TokenUsage } from './events.js';
import type { NodeContent, ToolCallRecord, FileChange } from './conversation.js';
import { assertNever } from '../guards.js';

/** 合并连续同类型文本块（text/thinking）；thinking 额外吸收事件 ts 为 startedAt/endedAt */
function appendMerge(
  content: NodeContent[],
  type: 'text' | 'thinking',
  text: string,
  ts?: number,
): void {
  const last = content[content.length - 1];
  if (last && last.type === type) {
    const block = last as { type: 'text' | 'thinking'; text: string; endedAt?: number };
    block.text += text;
    // 末 delta 时间：每个 thinking delta 刷新，流结束即定格（纯函数不打点，只消费事件 ts）
    if (type === 'thinking' && ts !== undefined) block.endedAt = ts;
  } else {
    content.push(
      type === 'thinking'
        ? {
            type,
            text,
            ...(ts !== undefined ? { startedAt: ts, endedAt: ts } : {}),
          }
        : { type, text },
    );
  }
}

/**
 * 将单个事件累积进 content 数组（原地修改，O(1)/delta）
 * client 直接传入 valtio proxy 数组以获得响应式；server 经 StreamAccumulator 使用。
 */
export function applyEventToContent(content: NodeContent[], event: SourceEvent): void {
  switch (event.type) {
    case 'text':
      appendMerge(content, 'text', event.content);
      break;
    case 'thinking':
      appendMerge(content, 'thinking', event.content, event.ts);
      break;
    case 'tool_call':
      content.push({
        type: 'tool_call',
        toolId: event.id,
        name: event.name,
        args: event.args,
        status: 'pending',
        ...(event.semantic ? { semantic: event.semantic } : {}),
        ...(event.ts !== undefined ? { startedAt: event.ts } : {}),
      });
      break;
    case 'tool_result': {
      const tc = content.find((c) => c.type === 'tool_call' && c.toolId === event.id);
      if (tc && tc.type === 'tool_call') {
        tc.status = event.isError ? 'error' : 'success';
        // 耗时回填到调用块：一次调用 = 一个视觉单元（视图层按 toolId 配对渲染）
        if (event.ts !== undefined) tc.endedAt = event.ts;
      }
      content.push({
        type: 'tool_result',
        toolId: event.id,
        name: event.name,
        result: event.result,
        isError: event.isError,
      });
      break;
    }
    case 'file_edit':
      content.push({
        type: 'diff',
        text: event.diff,
        path: event.path,
        ...(event.kind ? { kind: event.kind } : {}),
      });
      break;
    case 'terminal':
      content.push({ type: 'terminal', command: event.command, output: event.output });
      break;
    case 'error':
      content.push({ type: 'error', message: event.message, suggestion: event.suggestion });
      break;
    case 'compaction':
      // 压缩标记随内容落盘：reload 后仍能呈现"此处发生压缩"（live/reload 一致）
      content.push({
        type: 'compaction',
        trigger: event.trigger,
        ...(event.preTokens !== undefined ? { preTokens: event.preTokens } : {}),
        ...(event.summary ? { summary: event.summary } : {}),
      });
      break;
    case 'notice':
      content.push({ type: 'notice', level: event.level, text: event.message });
      break;
    case 'done':
      break;
    default:
      // exhaustiveness 兜底：SourceEvent 新增变体而本 switch 未补 → 编译报错；运行时触达即抛错
      assertNever(event);
  }
}

/**
 * StreamAccumulator — 内容累积 + 持久化元数据（server 用）
 *
 * 用法：
 *   增量：const acc = new StreamAccumulator(); acc.apply(event);
 *   批量：const acc = StreamAccumulator.fromEvents(events);
 */
export class StreamAccumulator {
  /** 累积的内容块 */
  readonly content: NodeContent[] = [];
  /** 工具调用记录（metadata 用） */
  readonly toolCalls: ToolCallRecord[] = [];
  /** 文件变更记录（metadata 用） */
  readonly fileChanges: FileChange[] = [];
  /** done 事件携带的流级信息 */
  usage: TokenUsage | undefined;
  sessionId: string | undefined;
  sourceMessageId: string | undefined;
  done = false;

  apply(event: SourceEvent): void {
    applyEventToContent(this.content, event);
    // 元数据级跟踪（仅持久化需要）：时间优先用事件 ts（编排层注入），
    // 缺失时 server 端 Date.now() 兜底（ToolCallRecord.startedAt 为必填字段）
    switch (event.type) {
      case 'tool_call':
        this.toolCalls.push({
          toolId: event.id,
          args: event.args,
          status: 'pending',
          startedAt: event.ts ?? Date.now(),
        });
        break;
      case 'tool_result': {
        const rec = this.toolCalls.find((t) => t.toolId === event.id);
        if (rec) {
          rec.result = event.result;
          rec.status = event.isError ? 'error' : 'success';
          rec.endedAt = event.ts ?? Date.now();
        }
        break;
      }
      case 'file_edit':
        this.fileChanges.push({
          path: event.path,
          diff: event.diff ?? '',
          status: 'pending',
        });
        break;
      case 'done':
        this.done = true;
        this.usage = event.usage;
        this.sessionId = event.sessionId;
        this.sourceMessageId = event.sourceMessageId;
        break;
    }
  }

  /** 批量转换（等价旧 buildPersistData） */
  static fromEvents(events: SourceEvent[]): StreamAccumulator {
    const acc = new StreamAccumulator();
    for (const e of events) acc.apply(e);
    return acc;
  }

  /** 节点持久化 metadata（仅事件衍生的类型化字段） */
  get nodeMetadata(): {
    toolCalls?: ToolCallRecord[];
    fileChanges?: FileChange[];
    sourceMessageId?: string;
    usage?: TokenUsage;
  } {
    return {
      ...(this.toolCalls.length > 0 ? { toolCalls: this.toolCalls } : {}),
      ...(this.fileChanges.length > 0 ? { fileChanges: this.fileChanges } : {}),
      ...(this.sourceMessageId ? { sourceMessageId: this.sourceMessageId } : {}),
      // usage 落盘：reload 后仍能展示 token 用量/上下文占用（input ≈ 当前上下文）
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }
}
