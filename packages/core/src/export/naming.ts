/**
 * 导出命名：目录/文件名的跨平台规范化与冲突消解素材。
 */
import { toKebabCase } from '../paths';

/** Windows 保留名 */
const WINDOWS_RESERVED = /^(con|nul|aux|prn|com\d|lpt\d)$/i;

/** 规范化为安全目录名：@scope/pkg → scope-pkg，全大写缩写词不粘连，非法字符移除，Windows 保留名加后缀 */
export function toSafeDirName(raw: string): string {
  let name = toKebabCase(
    raw
      .replace(/^@/, '')
      .replace(/\//g, '-')
      // 全大写缩写词与后续驼峰分段：HBOSSection → HBOS-Section（toKebabCase 只处理小写→大写边界）
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2'),
  );
  if (!name) name = 'project';
  if (WINDOWS_RESERVED.test(name)) name = `${name}-dir`;
  return name;
}

/** 项目文件夹名兜底链：name → mainPath basename → id */
export function resolveProjectFolder(p: { id: string; name: string; local_path: string }): string {
  let candidate = p.name;
  if (!candidate) {
    try {
      const paths: string[] = JSON.parse(p.local_path || '[]');
      const first = paths[0];
      if (first) candidate = first.split('/').pop() ?? '';
    } catch {
      // local_path 非法 JSON 时走 id 兜底
    }
  }
  if (!candidate) candidate = p.id;
  return toSafeDirName(candidate);
}

/** 短 ID：取冒号后前 8 位（git:dbd5070e... → dbd5070e） */
export function shortProjectId(id: string): string {
  const tail = id.includes(':') ? id.split(':').slice(1).join(':') : id;
  return (tail || id).slice(0, 8);
}

/** spec 导出文件名加 <user>__ 前缀（仅 basename；relativePath 可能含子目录） */
export function exportFileName(userName: string, relativePath: string): string {
  const parts = relativePath.split('/');
  const base = parts.pop() ?? '';
  return [...parts, `${userName}__${base}`].join('/');
}

/**
 * 任务导出基名：`<user>__<日期>-<短id>`。
 * 短 id = taskId 前段 `YYYY-MM-DD-xxxx`（date + 4hex）；标题完整保留在 frontmatter /
 * 正文 H1 / 目录行中——路径不再内嵌标题 slug（去重复表示，see ai-data-payload-token-economy §四）。
 */
export function taskExportBase(userName: string, taskId: string): string {
  const m = taskId.match(/^(\d{4}-\d{2}-\d{2}-[0-9a-f]{4})/i);
  const core = m ? m[1] : taskId.replace(/[/:*?"<>|\\]/g, '-');
  return `${userName}__${core}`;
}

/** 全 id 基名：短 id 撞名时的兜底（taskId 清洗非法字符） */
export function taskExportBaseFull(userName: string, taskId: string): string {
  const safe = taskId.replace(/[/:*?"<>|\\]/g, '-');
  return `${userName}__${safe}`;
}
