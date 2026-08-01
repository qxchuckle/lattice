/**
 * 结构化 prompt 输入（chip 编辑器的序列化形态）
 *
 * web 输入框 → server → agent 编排层三层流转；
 * 展开为最终 ContentBlock[] 由编排层 PromptComposer 完成，源永远只收纯内容。
 */
import { assertNever } from '../exhaustiveness.js';

/** 结构化 prompt 输入段（判别联合） */
export type PromptSegment =
  /** 自由文本 */
  | { type: 'text'; text: string }
  /** 命令 chip：name 为聚合注册表中的命令名（不含 / 前缀），args 为命令后自由文本 */
  | { type: 'command'; name: string; args?: string }
  /** 图片 chip（粘贴/选择）：base64 载荷，仅 vision 模型可用（能力由源的 ModelInfo.capabilities 声明） */
  | { type: 'image'; data: string; mimeType: string; name?: string }
  /** 引用 chip（server 可解析型）：spec/task 由编排层读取内容注入；file 为行内路径（agent 自行用工具读） */
  | { type: 'ref'; refType: 'file' | 'spec' | 'task'; id: string; display: string }
  /** 引用 chip（客户端内容型）：selection 等只有 client 知道内容，随消息携带 */
  | { type: 'inline-ref'; refType: 'selection' | 'node'; display: string; content: string };

/**
 * segments → 用户可见文本（chip 显示名 + 自由文本）。
 * 供树标题、节点列表摘要、无 segments 能力端的 message 兜底使用。
 */
export function segmentsToDisplayText(segments: PromptSegment[]): string {
  return segments
    .map((seg) => {
      switch (seg.type) {
        case 'text':
          return seg.text;
        case 'command':
          return `/${seg.name}${seg.args ? ` ${seg.args}` : ''}`;
        case 'image':
          return `[图片${seg.name ? `:${seg.name}` : ''}]`;
        case 'ref':
          return `@${seg.display}`;
        case 'inline-ref':
          return `@${seg.display}`;
        default:
          // exhaustiveness 兜底：PromptSegment 新增变体而本 switch 未补 → 编译报错；运行时触达即抛错
          return assertNever(seg);
      }
    })
    .join('')
    .trim();
}
