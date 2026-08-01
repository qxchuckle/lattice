/**
 * Block 渲染注册表
 *
 * 替代旧 switch 分发模式：新增消息类型只需 registerBlockRenderer 注册一项，
 * 无需修改 ContentBlockRenderer 的 switch 分支。
 *
 * ContentBlockRenderer 查表渲染：找到则调用，未注册类型走 assertNever 兜底。
 */
import type { NodeContent } from '@qcqx/lattice-agent-protocol';

/** 块渲染器函数签名 */
export type BlockRenderer = (props: {
  block: NodeContent;
  streaming?: boolean;
}) => React.JSX.Element | null;

/** 渲染器注册表：block.type → renderer */
export const BLOCK_RENDERERS = new Map<string, BlockRenderer>();

/** 内置类型集合（模块加载时快照，用于禁止覆盖已注册的内置渲染器） */
const BUILTIN_TYPES = new Set<string>();

/**
 * 封存当前已注册的所有类型为内置类型（后续 registerBlockRenderer 调用不可覆盖它们）。
 * 由 blocks/index.tsx 在所有内置渲染器注册完成后调用一次。
 */
export function sealBuiltinTypes(): void {
  for (const key of BLOCK_RENDERERS.keys()) {
    BUILTIN_TYPES.add(key);
  }
}

/** 注册一个块渲染器（幂等：同名覆盖；内置类型不允许外部覆盖） */
export function registerBlockRenderer(type: string, renderer: BlockRenderer): void {
  if (BUILTIN_TYPES.has(type) && BLOCK_RENDERERS.has(type)) {
    console.warn(`[block-registry] 内置类型 "${type}" 已注册，跳过覆盖`);
    return;
  }
  BLOCK_RENDERERS.set(type, renderer);
}

/** 获取已注册的块类型列表 */
export function getRegisteredBlockTypes(): string[] {
  return Array.from(BLOCK_RENDERERS.keys());
}
