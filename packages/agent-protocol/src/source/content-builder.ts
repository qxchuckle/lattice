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

/** 合并连续同类型文本块（text/thinking） */
function appendMerge(content: NodeContent[], type: 'text' | 'thinking', text: string): void {
  const last = content[content.length - 1];
  if (last && last.type === type) {
    (last as { type: 'text' | 'thinking'; text: string }).text += text;
  } else {
    content.push({ type, text });
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
      appendMerge(content, 'thinking', event.content);
      break;
    case 'tool_call':
      content.push({
        type: 'tool_call',
        toolId: event.id,
        name: event.name,
        args: event.args,
        status: 'pending',
      });
      break;
    case 'tool_result': {
      const tc = content.find((c) => c.type === 'tool_call' && c.toolId === event.id);
      if (tc && tc.type === 'tool_call') tc.status = event.isError ? 'error' : 'success';
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
      content.push({ type: 'diff', text: event.diff, path: event.path });
      break;
    case 'terminal':
      content.push({ type: 'terminal', command: event.command, output: event.output });
      break;
    case 'error':
      content.push({ type: 'error', message: event.message, suggestion: event.suggestion });
      break;
    case 'done':
      break;
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
    // 元数据级跟踪（仅持久化需要）
    switch (event.type) {
      case 'tool_call':
        this.toolCalls.push({
          toolId: event.id,
          args: event.args,
          status: 'pending',
          startedAt: Date.now(),
        });
        break;
      case 'tool_result': {
        const rec = this.toolCalls.find((t) => t.toolId === event.id);
        if (rec) {
          rec.result = event.result;
          rec.status = event.isError ? 'error' : 'success';
          rec.endedAt = Date.now();
        }
        break;
      }
      case 'file_edit':
        this.fileChanges.push({ path: event.path, diff: event.diff, status: 'pending' });
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
  } {
    return {
      ...(this.toolCalls.length > 0 ? { toolCalls: this.toolCalls } : {}),
      ...(this.fileChanges.length > 0 ? { fileChanges: this.fileChanges } : {}),
      ...(this.sourceMessageId ? { sourceMessageId: this.sourceMessageId } : {}),
    };
  }
}
