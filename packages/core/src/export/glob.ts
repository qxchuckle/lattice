/**
 * 过滤值 glob：引擎复用既有依赖 minimatch（仓库既有使用：`project/scan`、`sync/contribution`）。
 *
 * 差异处理：过滤值不是文件系统路径——`/` 是普通字符（remote / 包名含斜杠），
 * 而 minimatch 是路径语义（`*` 不跨 `/`，实测 `*qxchuckle*` 对
 * `github.com/qxchuckle/lattice` 静默 false）。匹配前把两侧 `/` 统一替换为
 * 占位符，使 `*` 自然跨段；`?` / `[…]` / `{a,b}` / nocase 等能力全部由
 * minimatch 提供（不自研转换器）。
 */
import { minimatch } from 'minimatch';

/** 占位符：替换 `/` 后 minimatch 视作普通字符（过滤值内不会出现） */
const SLASH = '\u0000';
const normalize = (s: string): string => s.replace(/\//g, SLASH);

/** 通配符检测：命中即走 glob；否则按 子串（项目）/ 前缀（条目）匹配 */
export function hasGlobMeta(value: string): boolean {
  return /[*?[{]/.test(value);
}

/** glob 整串匹配（大小写不敏感；`*` 匹配任意字符含 `/`，`?` 匹配单字符） */
export function globMatch(pattern: string, text: string): boolean {
  return minimatch(normalize(text), normalize(pattern), { nocase: true, nocomment: true });
}
