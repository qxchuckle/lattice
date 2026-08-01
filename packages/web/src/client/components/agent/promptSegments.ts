/**
 * promptSegments — chip 编辑器数据逻辑（纯函数模块，组件做薄壳可脚本测试）
 *
 * P1 模型：segments = [chips...] + 尾部自由文本。
 * chip 原子性由渲染层保证（独立元素整体删除）；数据层只是数组操作。
 */
import { assertNever } from '@qcqx/lattice-agent-protocol';
import type { PromptSegment, ResourceListItem } from '@qcqx/lattice-agent-protocol';

/** 编辑器内的 chip 项（key 供 React 渲染，segment 为序列化载荷） */
export interface ChipItem {
  key: string;
  segment: PromptSegment;
}

/** 命令资源 → chip */
export function commandChip(name: string): ChipItem {
  return {
    key: `cmd-${name}-${Date.now()}`,
    segment: { type: 'command', name },
  };
}

/** 粘贴/选择的图片 → chip（base64 载荷；仅 vision 模型可插入，能力由源声明） */
export function imageChip(data: string, mimeType: string, name?: string): ChipItem {
  return {
    key: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    segment: { type: 'image', data, mimeType, ...(name ? { name } : {}) },
  };
}

/** 文件引用 → chip（行内路径，agent 自行用工具读） */
export function fileChip(path: string, display: string): ChipItem {
  return {
    key: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    segment: { type: 'ref', refType: 'file', id: path, display },
  };
}

/** 编辑器选区 → chip（客户端内容型，随消息携带） */
export function selectionChip(text: string, display: string): ChipItem {
  return {
    key: `sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    segment: { type: 'inline-ref', refType: 'selection', display, content: text },
  };
}

/** 文件搜索结果（/api/agent/file-search） */
export interface FileSearchResult {
  path: string;
  name: string;
  /** 项目根下的相对路径（展示用） */
  root: string;
}

/** chip 显示文本（渲染 + 复制降级用） */
export function chipDisplay(segment: PromptSegment): string {
  switch (segment.type) {
    case 'command':
      return `/${segment.name}`;
    case 'image':
      return `[图片${segment.name ? `:${segment.name}` : ''}]`;
    case 'ref':
    case 'inline-ref':
      return `@${segment.display}`;
    case 'text':
      return segment.text;
    default:
      // exhaustiveness 兜底：PromptSegment 新增变体而本 switch 未补 → 编译报错；运行时触达即抛错
      return assertNever(segment);
  }
}

/** chips + 尾部文本 → 发送用 segments（无 chip 时返回 null = 走纯文本路径） */
export function buildSegments(chips: ChipItem[], text: string): PromptSegment[] | null {
  if (chips.length === 0) return null;
  const segments = chips.map((c) => c.segment);
  const trimmed = text.trim();
  if (trimmed) segments.push({ type: 'text', text: trimmed });
  return segments;
}

/** `/` 菜单过滤：按命令名/描述子串匹配（大小写不敏感），仅 command 类资源 */
export function filterCommandResources(
  resources: ResourceListItem[],
  keyword: string,
): ResourceListItem[] {
  const commands = resources.filter((r) => r.kind === 'command');
  const kw = keyword.trim().toLowerCase();
  if (!kw) return commands;
  return commands.filter(
    (r) => r.name.toLowerCase().includes(kw) || (r.description ?? '').toLowerCase().includes(kw),
  );
}

/** 输入值是否处于 slash 触发态（以 / 开头且未离开首 token） */
export function slashKeyword(input: string): string | null {
  if (!input.startsWith('/')) return null;
  const token = input.slice(1);
  if (token.includes('\n')) return null;
  return token;
}

/** 输入值是否处于 @ 引用触发态（以 @ 开头且未换行） */
export function atKeyword(input: string): string | null {
  if (!input.startsWith('@')) return null;
  const token = input.slice(1);
  if (token.includes('\n')) return null;
  return token;
}
