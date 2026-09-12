/**
 * 路径展示纯函数（零 Node.js 依赖）。
 *
 * 与 `paths/index.ts` 的 Node 版 `homeToTilde` 共享同一改写规则，但 home / sep 由调用方显式传入，
 * 因此可经 core `browser.ts` 供 web client 使用（浏览器无 `homedir()` / `node:path`，且 vite dev
 * 不树摇，从 `paths/index.ts` re-export 会拉入 node:os 等依赖）。
 */

/**
 * 把 str 中的 home 前缀替换为 `~`+sep，用于**输出展示**（护隐私 + 省 token）。
 *
 * - 纯函数、幂等：结果不再含 home 前缀，二次调用 no-op（多通道重叠处理安全）。
 * - replace-all：捕获嵌在句子中间的路径，不止行首。
 * - 边界安全：只匹配 `home + sep` 前缀（或整串恰为 home），避免 `/Users/a1` 误伤 `/Users/a10`。
 * - **仅用于展示层**：存储元数据与数据读取返回值必须保留真实绝对路径，绝不 ~化。
 */
export function homeToTildeWith(str: string, home: string, sep: string): string {
  if (!str || !home) return str;
  if (str === home) return '~';
  return str.split(home + sep).join('~' + sep);
}
