/**
 * PromptComposer — 结构化输入段 → 最终 prompt 内容块（编排层展开，源永远只收纯内容）
 *
 * 展开策略：
 *   - command(origin=local)：模板全文标记包裹（实证对齐 Qoder 的 command 展开形态）
 *   - command(源 native)：透传 '/name args' 由源自行解释（Pi prompt 模板/skill 命令）
 *   - image：独立 image block 保序透传（vision 能力由源的 ModelInfo.capabilities 声明，UI 层门控）
 *   - ref(file)：行内路径 @path（agent 自行用工具读，不注入内容）；ref(spec/task)：内容注入 + 标记包裹
 *   - inline-ref：携带内容直接注入；不可解析引用降级为显示文本
 */
import type { PromptSegment, ContentBlock } from '@qcqx/lattice-agent-protocol';
import { segmentsToDisplayText, assertNever } from '@qcqx/lattice-agent-protocol';

export interface PromptComposerDeps {
  /** 本地命令名 → 模板正文；null = 非本地命令（源级命令透传 slash 文本） */
  resolveCommandTemplate?: (name: string) => Promise<string | null>;
  /** 引用内容读取（spec 正文 / task PRD / 文件）；null = 不可解析 */
  resolveRef?: (refType: 'file' | 'spec' | 'task', id: string) => Promise<string | null>;
}

export interface ComposedPrompt {
  /** 展开后的最终内容块（落盘 user 节点 content + 传源）：文本段合并，image 保序独立 block */
  blocks: ContentBlock[];
  /** 用户可见文本（树标题/列表摘要） */
  displayText: string;
}

/** 文件引用注入大小上限（超限截断加注，防止把上下文撑爆） */
const REF_CONTENT_LIMIT = 32_000;

function clip(content: string): string {
  return content.length > REF_CONTENT_LIMIT
    ? `${content.slice(0, REF_CONTENT_LIMIT)}\n…（内容超限已截断）`
    : content;
}

export async function composePrompt(
  segments: PromptSegment[],
  deps: PromptComposerDeps = {},
): Promise<ComposedPrompt> {
  const blocks: ContentBlock[] = [];
  let parts: string[] = [];

  // 累积文本段合并为单 text block（遇 image 切断，保持文本与图片的相对顺序）
  const flushText = (): void => {
    const text = parts.join('\n').trim();
    if (text) blocks.push({ type: 'text', text });
    parts = [];
  };

  for (const seg of segments) {
    switch (seg.type) {
      case 'text':
        parts.push(seg.text);
        break;

      case 'image':
        flushText();
        blocks.push({ type: 'image', data: seg.data, mimeType: seg.mimeType });
        break;

      case 'command': {
        const template = (await deps.resolveCommandTemplate?.(seg.name)) ?? null;
        if (template !== null) {
          // 本地命令：模板全文注入，args 拼在用户文本区（Qoder 同款形态）
          const argsPart = seg.args ? `${seg.args}\n\n` : '';
          parts.push(
            `${argsPart}--- Lattice Command: ${seg.name} ---\n${template}\n--- End Command ---`,
          );
        } else {
          // 源级命令（native 源自行解释）或未知命令：均透传 slash 文本
          // （none 源收到未知命令 = 普通文本，模型按字面理解，防御路径）
          parts.push(`/${seg.name}${seg.args ? ` ${seg.args}` : ''}`);
        }
        break;
      }

      case 'ref': {
        if (seg.refType === 'file') {
          // 文件行内：只给路径，agent 自行用工具读（与主流 agent 一致，不撑爆上下文）
          parts.push(`@${seg.id}`);
          break;
        }
        const content = (await deps.resolveRef?.(seg.refType, seg.id)) ?? null;
        if (content !== null) {
          parts.push(
            `--- Ref ${seg.refType}: ${seg.display} ---\n${clip(content)}\n--- End Ref ---`,
          );
        } else {
          parts.push(`@${seg.display}`); // 不可解析：保留显示文本
        }
        break;
      }

      case 'inline-ref':
        parts.push(
          `--- Ref ${seg.refType}: ${seg.display} ---\n${clip(seg.content)}\n--- End Ref ---`,
        );
        break;

      default:
        // exhaustiveness 兜底：PromptSegment 新增段类型而本 switch 未补 → 编译报错
        assertNever(seg);
    }
  }
  flushText();

  return { blocks, displayText: segmentsToDisplayText(segments) };
}
