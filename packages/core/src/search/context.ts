import type {
  ParsedSpec,
  TaskMeta,
  ProjectContext,
  SmartContext,
  RelatedProjectEntry,
  RelatedProjectRelationEntry,
  CrossUserProjectData,
  CrossUserTaskData,
  AncestorProjectInfo,
} from '../types';
import {
  getProjectSpecs,
  getUserSpecs,
  getGlobalSpecs,
  getCascadedSpecs,
  getCascadedSpecsWithAncestors,
} from '../spec';
import { parseSpec } from '../spec/io';
import { getTaskMeta } from '../task';
import { listProjects, normalizeProjectId, getVirtualProjectMeta } from '../project';
import { getRelationsByProject } from '../project/relation';
import { findSameProjectInOtherUsers } from '../project/cross-user';
import { getRelatedProjectIds } from '../project/virtual-merge';
import { selectPrimaryId } from '../project/identity';
import { getTasksForProject } from '../db';
import { semanticSearch } from '../rag';
import { readProfileSummary, readProfileTags } from '../project/profile';

/**
 * 获取虚拟合并组的所有任务 ID（去重）
 */
function getTaskIdsForProjectGroup(projectId: string): string[] {
  const relatedIds = getRelatedProjectIds(projectId);
  const taskIdSet = new Set<string>();
  for (const rid of relatedIds) {
    const ids = getTasksForProject(rid);
    for (const id of ids) {
      taskIdSet.add(id);
    }
  }
  return [...taskIdSet];
}

export interface ContextOptions {
  /** 是否启用跨用户聚合（默认 true） */
  crossUser?: boolean;
  /** 祖先项目 ID 列表（近→远），用于嵌套项目 spec 继承 */
  ancestorProjectIds?: string[];
  /** 祖先项目信息（包含名称和路径，用于输出） */
  ancestors?: AncestorProjectInfo[];
}

/**
 * 收集某个其他用户对同一项目的上下文数据。
 */
async function collectCrossUserProjectData(
  otherUsername: string,
  otherProjectId: string,
): Promise<CrossUserProjectData> {
  // 项目级 spec
  const projectSpecs = await getProjectSpecs(otherUsername, otherProjectId);

  // 用户级 spec
  const userSpecs = await getUserSpecs(otherUsername);

  // 活跃任务
  let activeTasks: TaskMeta[] = [];
  try {
    const taskIds = getTaskIdsForProjectGroup(otherProjectId);
    const allTasks = await Promise.all(taskIds.map((id) => getTaskMeta(otherUsername, id)));
    activeTasks = allTasks.filter(
      (t): t is TaskMeta => t !== null && t.status !== 'archived' && t.status !== 'completed',
    );
  } catch {
    // ignore
  }

  // 关联项目
  const relatedProjects: RelatedProjectEntry[] = [];
  try {
    const relations = await getRelationsByProject(otherUsername, otherProjectId);
    const relatedMap = new Map<string, RelatedProjectEntry>();
    for (const r of relations) {
      const relatedId = r.projectA === otherProjectId ? r.projectB : r.projectA;
      let entry = relatedMap.get(relatedId);
      if (!entry) {
        const meta = await getVirtualProjectMeta(otherUsername, relatedId);
        if (!meta) continue;
        entry = {
          id: selectPrimaryId(meta.ids) ?? relatedId,
          name: meta.name,
          relations: [],
        };
        relatedMap.set(relatedId, entry);
        relatedProjects.push(entry);
      }
      const relEntry: RelatedProjectRelationEntry = {
        relId: r.id,
        type: r.type,
        description: r.description,
      };
      entry.relations.push(relEntry);
    }
  } catch {
    // ignore
  }

  return {
    username: otherUsername,
    projectId: otherProjectId,
    projectSpecs,
    userSpecs,
    activeTasks,
    relatedProjects,
  };
}

/** 获取项目的完整上下文（三层 spec 聚合 + 关联信息 + 跨用户聚合 + 祖先继承） */
export async function getContextForProject(
  username: string,
  projectId: string,
  options?: ContextOptions,
): Promise<ProjectContext> {
  const crossUser = options?.crossUser ?? true;
  const ancestorProjectIds = options?.ancestorProjectIds;
  const ancestors = options?.ancestors;

  // 入口归一化：确保 projectId 带前缀（兼容老格式无前缀 ID）
  const normalizedProjectId = normalizeProjectId(projectId);

  // 根据是否有祖先项目，选择不同的级联策略
  let projectSpecs: ParsedSpec[];
  let userSpecs: ParsedSpec[];
  let globalSpecs: ParsedSpec[];
  let cascadedSpecs: ParsedSpec[];
  let ancestorSpecs: ParsedSpec[] | undefined;

  if (ancestorProjectIds && ancestorProjectIds.length > 0) {
    // 有祖先项目：使用含祖先的级联聚合
    const [pSpecs, uSpecs, gSpecs, cascadeResult] = await Promise.all([
      getProjectSpecs(username, normalizedProjectId),
      getUserSpecs(username),
      getGlobalSpecs(),
      getCascadedSpecsWithAncestors(username, normalizedProjectId, ancestorProjectIds),
    ]);
    projectSpecs = pSpecs;
    userSpecs = uSpecs;
    globalSpecs = gSpecs;
    cascadedSpecs = cascadeResult.cascaded;
    ancestorSpecs = cascadeResult.ancestorSpecs;
  } else {
    // 无祖先项目：使用原有三层级联
    [projectSpecs, userSpecs, globalSpecs, cascadedSpecs] = await Promise.all([
      getProjectSpecs(username, normalizedProjectId),
      getUserSpecs(username),
      getGlobalSpecs(),
      getCascadedSpecs(username, normalizedProjectId),
    ]);
  }

  // 查找关联的活跃任务
  let activeTasks: TaskMeta[] = [];
  try {
    const taskIds = getTaskIdsForProjectGroup(normalizedProjectId);
    const allTasks = await Promise.all(taskIds.map((id) => getTaskMeta(username, id)));
    activeTasks = allTasks.filter(
      (t): t is TaskMeta => t !== null && t.status !== 'archived' && t.status !== 'completed',
    );
  } catch {
    // 数据库可能未初始化
  }

  // 查找关联项目（同一项目可能有多条关系）
  const relatedProjects: RelatedProjectEntry[] = [];
  const relatedMap = new Map<string, RelatedProjectEntry>();
  try {
    const relations = await getRelationsByProject(username, normalizedProjectId);
    for (const r of relations) {
      const relatedId = r.projectA === normalizedProjectId ? r.projectB : r.projectA;
      let entry = relatedMap.get(relatedId);
      if (!entry) {
        const meta = await getVirtualProjectMeta(username, relatedId);
        if (!meta) continue;
        entry = {
          id: selectPrimaryId(meta.ids) ?? relatedId,
          name: meta.name,
          relations: [],
        };
        relatedMap.set(relatedId, entry);
        relatedProjects.push(entry);
      }
      const relEntry: RelatedProjectRelationEntry = {
        relId: r.id,
        type: r.type,
        description: r.description,
      };
      entry.relations.push(relEntry);
    }
  } catch {
    // relations.json 未初始化
  }

  // 同组项目
  const projectMeta = await getVirtualProjectMeta(username, normalizedProjectId);
  if (projectMeta?.groups?.length) {
    const allProjects = listProjects(username);
    for (const p of allProjects) {
      if (p.id === normalizedProjectId) continue;
      if (relatedMap.has(p.id)) continue;
      const groups = p.groups ? JSON.parse(p.groups) : [];
      const shared = projectMeta.groups.filter((g) => groups.includes(g));
      if (shared.length > 0) {
        relatedProjects.push({
          id: p.id,
          name: p.name,
          relations: [
            {
              relId: '',
              type: 'same-group',
              description: `同组：${shared.join(', ')}`,
            },
          ],
        });
      }
    }
  }

  // 跨用户聚合
  let crossUserData: CrossUserProjectData[] | undefined;
  if (crossUser) {
    const otherUsers = await findSameProjectInOtherUsers(username, normalizedProjectId);
    if (otherUsers.length > 0) {
      crossUserData = await Promise.all(
        otherUsers.map((u) => collectCrossUserProjectData(u.username, u.projectId)),
      );
      // 过滤掉没有任何有效数据的条目
      crossUserData = crossUserData.filter(
        (d) =>
          d.projectSpecs.length > 0 ||
          d.userSpecs.length > 0 ||
          d.activeTasks.length > 0 ||
          d.relatedProjects.length > 0,
      );
      if (crossUserData.length === 0) crossUserData = undefined;
    }
  }

  return {
    projectSpecs,
    userSpecs,
    globalSpecs,
    cascadedSpecs,
    activeTasks,
    relatedProjects,
    crossUserData,
    ancestors,
    ancestorSpecs: ancestorSpecs && ancestorSpecs.length > 0 ? ancestorSpecs : undefined,
  };
}

/** 获取任务关联的智能上下文 */
export async function getSmartContext(
  username: string,
  taskId: string,
  options?: ContextOptions,
): Promise<SmartContext> {
  const crossUser = options?.crossUser ?? true;
  const task = await getTaskMeta(username, taskId);
  if (!task) throw new Error(`未找到任务：${taskId}`);

  const directSpecs: ParsedSpec[] = [];
  const groupSet = new Set<string>();

  // 收集直接关联项目的 spec
  if (task.projects?.length) {
    const specArrays = await Promise.all(
      task.projects.map((pid) => getProjectSpecs(username, pid)),
    );
    const seenPaths = new Set<string>();
    for (const specs of specArrays) {
      for (const s of specs) {
        if (!seenPaths.has(s.filePath)) {
          seenPaths.add(s.filePath);
          directSpecs.push(s);
        }
      }
    }

    for (const pid of task.projects) {
      const meta = await getVirtualProjectMeta(username, pid);
      if (meta?.groups) {
        for (const g of meta.groups) groupSet.add(g);
      }
    }
  }

  // 收集同组项目的 spec
  const relatedSpecs: ParsedSpec[] = [];
  if (groupSet.size > 0) {
    const directIds = new Set(task.projects ?? []);
    const allProjects = listProjects(username);
    const relatedIds = allProjects
      .filter((p) => {
        if (directIds.has(p.id)) return false;
        const groups = p.groups ? JSON.parse(p.groups) : [];
        return groups.some((g: string) => groupSet.has(g));
      })
      .map((p) => p.id);

    if (relatedIds.length > 0) {
      const specArrays = await Promise.all(relatedIds.map((pid) => getProjectSpecs(username, pid)));
      relatedSpecs.push(...specArrays.flat());
    }
  }

  // 跨用户聚合
  let crossUserData: CrossUserTaskData[] | undefined;
  if (crossUser && task.projects?.length) {
    const allOtherUsers: { username: string; projectId: string }[] = [];
    for (const pid of task.projects) {
      const others = await findSameProjectInOtherUsers(username, pid);
      allOtherUsers.push(...others);
    }

    // 去重
    const seen = new Set<string>();
    const uniqueOthers = allOtherUsers.filter((u) => {
      const key = `${u.username}:${u.projectId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueOthers.length > 0) {
      const dataByUser = new Map<string, CrossUserTaskData>();

      for (const other of uniqueOthers) {
        let entry = dataByUser.get(other.username);
        if (!entry) {
          entry = { username: other.username, directSpecs: [], activeTasks: [] };
          dataByUser.set(other.username, entry);
        }

        // 项目级 spec
        const specs = await getProjectSpecs(other.username, other.projectId);
        entry.directSpecs.push(...specs);

        // 活跃任务
        try {
          const taskIds = getTasksForProject(other.projectId);
          const tasks = await Promise.all(taskIds.map((id) => getTaskMeta(other.username, id)));
          const active = tasks.filter(
            (t): t is TaskMeta => t !== null && t.status !== 'archived' && t.status !== 'completed',
          );
          entry.activeTasks.push(...active);
        } catch {
          // ignore
        }
      }

      crossUserData = Array.from(dataByUser.values()).filter(
        (d) => d.directSpecs.length > 0 || d.activeTasks.length > 0,
      );
      if (crossUserData.length === 0) crossUserData = undefined;
    }
  }

  // 通过 RAG 语义搜索发现与任务相关的 spec
  const semanticSpecs: ParsedSpec[] = [];
  try {
    const existingPaths = new Set([
      ...directSpecs.map((s) => s.filePath),
      ...relatedSpecs.map((s) => s.filePath),
    ]);
    const semanticResults = await semanticSearch(task.title, 20, {
      type: 'spec',
      distanceThreshold: 1.2,
    });
    const dedupedResults = semanticResults.filter((r) => !existingPaths.has(r.filePath));
    const parsedResults = await Promise.all(
      dedupedResults.slice(0, 5).map((r) => parseSpec(r.filePath)),
    );
    for (const spec of parsedResults) {
      if (spec) semanticSpecs.push(spec);
    }
  } catch {
    // RAG 不可用时静默回退
  }

  return {
    task,
    directSpecs,
    relatedSpecs,
    semanticSpecs,
    crossUserData,
  };
}

/** 判断 spec 所属的作用域层级 */
export function resolveSpecScope(
  spec: ParsedSpec,
  ctx: ProjectContext,
): 'project' | 'ancestor' | 'user' | 'global' {
  const fp = spec.filePath;
  if (ctx.projectSpecs.some((s) => s.filePath === fp)) return 'project';
  if (ctx.ancestorSpecs?.some((s) => s.filePath === fp)) return 'ancestor';
  if (ctx.userSpecs.some((s) => s.filePath === fp)) return 'user';
  if (ctx.globalSpecs.some((s) => s.filePath === fp)) return 'global';
  // fallback：从路径推断
  if (fp.includes('/projects/')) return 'project';
  if (fp.includes('/users/')) return 'user';
  return 'global';
}

const SCOPE_LABEL: Record<string, string> = {
  project: '项目级',
  ancestor: '祖先项目',
  user: '用户级',
  global: '全局级',
};

/** 将上下文格式化为 Markdown 输出 */
export function formatContextAsMarkdown(
  ctx: ProjectContext,
  profileSection?: string,
  queryMatchedPaths?: Set<string>,
): string {
  const lines: string[] = [];

  lines.push('# 项目上下文\n');

  // 项目画像（置于最顶部）
  if (profileSection) {
    lines.push(profileSection);
    lines.push('');
  }

  // 祖先项目继承提示
  if (ctx.ancestors && ctx.ancestors.length > 0) {
    lines.push('## 嵌套项目继承\n');
    lines.push(`本项目检测到 ${ctx.ancestors.length} 个祖先 Lattice 项目，规范已自动级联继承：\n`);
    for (let i = 0; i < ctx.ancestors.length; i++) {
      const a = ctx.ancestors[i];
      const label = i === 0 ? '直接父级' : `第 ${i + 1} 级祖先`;
      lines.push(`- **${a.name ?? a.id.slice(0, 8)}** (${label}) — ${a.root}`);
    }
    lines.push('');
    lines.push(
      `级联优先级：当前项目 > ${ctx.ancestors.map((a) => a.name ?? a.id.slice(0, 8)).join(' > ')} > 用户级 > 全局级\n`,
    );
  }

  if (ctx.cascadedSpecs.length > 0) {
    lines.push('## 规范（Spec）\n');
    // 语义匹配的排前面
    const sorted = queryMatchedPaths?.size
      ? [...ctx.cascadedSpecs].sort((a, b) => {
          const am = queryMatchedPaths.has(a.filePath) ? 1 : 0;
          const bm = queryMatchedPaths.has(b.filePath) ? 1 : 0;
          return bm - am;
        })
      : ctx.cascadedSpecs;
    for (const spec of sorted) {
      const title = spec.frontmatter.title ?? spec.fileName.replace('.md', '');
      const scope = resolveSpecScope(spec, ctx);
      const scopeTag = SCOPE_LABEL[scope] ?? scope;
      const description =
        typeof spec.frontmatter.description === 'string' && spec.frontmatter.description.trim()
          ? spec.frontmatter.description.trim()
          : '[缺失摘要]';
      const matched = queryMatchedPaths?.has(spec.filePath) ? '★ ' : '';
      lines.push(`### ${matched}${title}\n`);
      lines.push(`- ${scopeTag}`);
      lines.push(`- ${spec.filePath}`);
      lines.push(`- ${description}`);
      lines.push('');
    }
  }

  if (ctx.activeTasks.length > 0) {
    lines.push('## 活跃任务\n');
    for (const task of ctx.activeTasks) {
      lines.push(`- **${task.title}** (${task.status}) — ${task.id}`);
    }
    lines.push('');
  }

  if (ctx.relatedProjects.length > 0) {
    lines.push('## 关联项目\n');
    for (const p of ctx.relatedProjects) {
      const relStrs = p.relations.map((r) => r.description ?? r.type);
      lines.push(`- **${p.name}** — ${relStrs.join(' / ')}`);
    }
    lines.push('');
  } else {
    lines.push('## 关联项目\n');
    lines.push(
      '暂无记录。如涉及多项目协作，可运行 `lattice project relation add` 记录项目间关系。\n',
    );
  }

  // 跨用户聚合数据
  if (ctx.crossUserData && ctx.crossUserData.length > 0) {
    lines.push('## 跨用户聚合\n');
    for (const userData of ctx.crossUserData) {
      lines.push(`### 来源用户：${userData.username}\n`);

      if (userData.projectSpecs.length > 0) {
        lines.push(`#### 项目级 Spec（${userData.projectSpecs.length}）\n`);
        for (const spec of userData.projectSpecs) {
          const title = spec.frontmatter.title ?? spec.fileName.replace('.md', '');
          const description =
            typeof spec.frontmatter.description === 'string' && spec.frontmatter.description.trim()
              ? spec.frontmatter.description.trim()
              : '[缺失摘要]';
          lines.push(`- **${title}** — ${description}`);
          lines.push(`  路径：${spec.filePath}`);
        }
        lines.push('');
      }

      if (userData.userSpecs.length > 0) {
        lines.push(`#### 用户级 Spec（${userData.userSpecs.length}）\n`);
        for (const spec of userData.userSpecs) {
          const title = spec.frontmatter.title ?? spec.fileName.replace('.md', '');
          const description =
            typeof spec.frontmatter.description === 'string' && spec.frontmatter.description.trim()
              ? spec.frontmatter.description.trim()
              : '[缺失摘要]';
          lines.push(`- **${title}** — ${description}`);
          lines.push(`  路径：${spec.filePath}`);
        }
        lines.push('');
      }

      if (userData.activeTasks.length > 0) {
        lines.push(`#### 活跃任务（${userData.activeTasks.length}）\n`);
        for (const task of userData.activeTasks) {
          lines.push(`- **${task.title}** (${task.status}) — ${task.id}`);
        }
        lines.push('');
      }

      if (userData.relatedProjects.length > 0) {
        lines.push(`#### 关联项目（${userData.relatedProjects.length}）\n`);
        for (const p of userData.relatedProjects) {
          const relStrs = p.relations.map((r) => r.description ?? r.type);
          lines.push(`- **${p.name}** — ${relStrs.join(' / ')}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
