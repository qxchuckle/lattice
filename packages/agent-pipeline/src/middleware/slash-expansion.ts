/**
 * expand 相位：slash 命令展开（polyfill 类 —— 仅在源不原生解释时装配）
 *
 * 展开形态与 Qoder IDE 实证一致：`--- Command: name ---\n模板全文\n--- End Command ---`，
 * args 置于模板之前（模型先看到用户参数再看到指令正文）。
 *
 * 只处理**文本块开头**的 `/name args`：命令语义在行首，正文中的斜杠不误伤。
 * 模板解析不到 → 原样保留（源侧可能自有解释，或就是普通文本）。
 */
import type { ContentBlock, SourceMiddleware, PromptPayload } from '@qcqx/lattice-agent-protocol';

export interface SlashExpansionOptions {
  /** 命令名 → 模板正文；null = 未知命令（原样透传） */
  resolveTemplate: (name: string) => Promise<string | null>;
  /** 展开标记文案（缺省 'Command'；宿主可改成自己的品牌，如 'Lattice Command'） */
  label?: string;
}

/** 首行 `/name args` 解析（命令名限 [A-Za-z0-9_:-]，冒号支持 skill:name 形态） */
const SLASH_PATTERN = /^\/([A-Za-z0-9_:-]+)(?:[ \t]+([\s\S]*))?$/;

export function parseSlashCommand(text: string): { name: string; args?: string } | null {
  const firstBreak = text.indexOf('\n');
  const head = firstBreak === -1 ? text : text.slice(0, firstBreak);
  const rest = firstBreak === -1 ? '' : text.slice(firstBreak + 1);
  const match = SLASH_PATTERN.exec(head.trim());
  if (!match) return null;
  const args = [match[2], rest].filter((s) => s && s.trim()).join('\n');
  return { name: match[1], args: args || undefined };
}

export function formatExpansion(
  name: string,
  template: string,
  args: string | undefined,
  label: string,
): string {
  const argsPart = args ? `${args}\n\n` : '';
  return `${argsPart}--- ${label}: ${name} ---\n${template}\n--- End ${label} ---`;
}

export function createSlashExpansionMiddleware(options: SlashExpansionOptions): SourceMiddleware {
  const label = options.label ?? 'Command';
  return {
    name: 'slash-expansion',
    phase: 'expand',
    async transformPrompt(payload: PromptPayload): Promise<PromptPayload> {
      let changed = false;
      const blocks: ContentBlock[] = [];
      for (const block of payload.message) {
        if (block.type !== 'text') {
          blocks.push(block);
          continue;
        }
        const parsed = parseSlashCommand(block.text);
        const template = parsed ? await options.resolveTemplate(parsed.name) : null;
        if (!parsed || template === null) {
          blocks.push(block);
          continue;
        }
        blocks.push({
          type: 'text',
          text: formatExpansion(parsed.name, template, parsed.args, label),
        });
        changed = true;
      }
      return changed ? { ...payload, message: blocks } : payload;
    },
  };
}
