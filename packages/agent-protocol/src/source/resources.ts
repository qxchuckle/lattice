/**
 * 源环境资源发现（统一契约）
 *
 * 上层只问「这个源环境里有哪些命令/子 agent/skill/rules」，
 * 源怎么知道的（SDK API / 产品约定目录扫描 / builtin 表）是源层私有知识，不外泄。
 */

/** 源环境中可发现的资源种类 */
export type SourceResourceKind = 'command' | 'agent' | 'skill' | 'rule';

/** 源环境中可发现的资源（可执行实体 + 规则文件） */
export interface SourceResourceInfo {
  kind: SourceResourceKind;
  /** 展示/调用名：'compact'、'lattice/task/start'、'AGENTS.md'（不含 / 前缀） */
  name: string;
  description?: string;
  /** 参数提示（kind='command' 补全菜单用），如 '<task-id | 描述>' */
  argumentHint?: string;
  /** 作用域：builtin=产品内置 / user=用户级目录 / project=项目级目录 / extension=插件提供 */
  scope?: 'builtin' | 'user' | 'project' | 'extension';
  /** 资源文件路径（rule/skill 正文所在，UI 查看入口；builtin 无） */
  path?: string;
}

/** 资源发现查询条件 */
export interface SourceResourceQuery {
  /** 项目目录（项目级 .pi/.qoder 等约定目录发现用）；缺省 = 用户主目录（仅全局/用户级资源） */
  cwd?: string;
  /** 过滤种类；缺省全部 */
  kinds?: SourceResourceKind[];
}

/** 按源分组的资源映射（registry 聚合查询用） */
export type SourceResourcesMap = Record<string, SourceResourceInfo[]>;
