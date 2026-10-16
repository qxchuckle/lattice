/**
 * 独立分发守卫：导出内容的环境耦合与敏感信息检测（只报告不改写）。
 *
 * 四类警告（v2.5 扩展）：
 * - local-path：本机绝对路径（/Users、/home、Windows 盘符、~/…）
 * - lattice-path：~/.lattice 路径引用
 * - ltc-ref：ltc 命令引用
 * - dangling-ref：引用了未导出的 spec 文件
 * - sensitive：疑似敏感信息（密钥/token 赋值形态）
 */
import type { ExportWarning } from './types';

export interface GuardFile {
  path: string;
  content: string;
}

const LOCAL_PATH_RE =
  /\/Users\/[^/\s"'()]+|\/home\/[^/\s"'()]+|[A-Za-z]:[\\/][^\s"'()]+|(^|[\s"'`(])~\/(?!\.lattice)[^\s"'()]+/m;
const LATTICE_PATH_RE = /~\/\.lattice/;
const LTC_REF_RE = /(^|[^a-zA-Z])ltc\s+\w/;
const SENSITIVE_RE =
  /(password|passwd|token|secret|api[_-]?key|apikey|authorization|bearer)\s*[:=]\s*["']?\S{4,}/i;
const MD_REF_RE = /[\w.-]+\.md/g;

export function detectWarnings(
  files: GuardFile[],
  sourceSpecNames: Set<string>,
  exportedSpecNames: Set<string>,
): ExportWarning[] {
  const warnings: ExportWarning[] = [];

  for (const f of files) {
    const content = f.content;
    if (LOCAL_PATH_RE.test(content)) {
      warnings.push({
        file: f.path,
        type: 'local-path',
        message:
          '正文含本机绝对路径（/Users、/home、Windows 盘符、~/…）：使用方按项目匹配信息（包名/git remote）映射到本机等效路径（SKILL.md「使用注意」已附引导）',
      });
    }
    if (LATTICE_PATH_RE.test(content)) {
      warnings.push({
        file: f.path,
        type: 'lattice-path',
        message:
          '正文含 ~/.lattice 路径引用，外部使用者无法解析（SKILL.md「使用注意」已附等效处理引导）',
      });
    }
    if (LTC_REF_RE.test(content)) {
      warnings.push({
        file: f.path,
        type: 'ltc-ref',
        message:
          '正文含 ltc 命令引用，外部使用者无 lattice 环境（SKILL.md「使用注意」已附等效处理引导）',
      });
    }
    if (SENSITIVE_RE.test(content)) {
      warnings.push({
        file: f.path,
        type: 'sensitive',
        message: '正文疑似含敏感信息（密钥/token 赋值形态），分发前必须人工确认',
      });
    }
    // 悬空引用：引用了源库中存在但未导出的 spec 文件名
    const refs = content.match(MD_REF_RE) ?? [];
    for (const ref of refs) {
      if (sourceSpecNames.has(ref) && !exportedSpecNames.has(ref)) {
        warnings.push({
          file: f.path,
          type: 'dangling-ref',
          message: `引用了未导出的 spec 文件：${ref}`,
        });
      }
    }
  }

  return warnings;
}
