import type {
  ParsedSpec,
  TaskMeta,
  ProjectContext,
  SmartContext,
  RelatedProjectEntry,
  RelatedProjectRelationEntry,
} from '../types';
import { getProjectSpecs, getUserSpecs, getGlobalSpecs, getCascadedSpecs } from '../spec';
import { listTasks, getTaskMeta } from '../task';
import { getProjectMeta, listProjects } from '../project';
import { getRelationsByProject } from '../project/relation';
import { getTasksForProject } from '../db';

/** 获取项目的完整上下文（三层 spec 聚合 + 关联信息） */
export async function getContextForProject(
  username: string,
  projectId: string,
): Promise<ProjectContext> {
  const [projectSpecs, userSpecs, globalSpecs, cascadedSpecs] = await Promise.all([
    getProjectSpecs(username, projectId),
    getUserSpecs(username),
    getGlobalSpecs(),
    getCascadedSpecs(username, projectId),
  ]);

  // 查找关联的活跃任务
  let activeTasks: TaskMeta[] = [];
  try {
    const taskIds = getTasksForProject(projectId);
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
    const relations = await getRelationsByProject(username, projectId);
    for (const r of relations) {
      const relatedId = r.projectA === projectId ? r.projectB : r.projectA;
      let entry = relatedMap.get(relatedId);
      if (!entry) {
        const meta = await getProjectMeta(username, relatedId);
        if (!meta) continue;
        entry = { id: meta.id, name: meta.name, relations: [] };
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
  const projectMeta = await getProjectMeta(username, projectId);
  if (projectMeta?.groups?.length) {
    const allProjects = listProjects(username);
    for (const p of allProjects) {
      if (p.id === projectId) continue;
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

  return {
    projectSpecs,
    userSpecs,
    globalSpecs,
    cascadedSpecs,
    activeTasks,
    relatedProjects,
  };
}

/** 获取任务关联的智能上下文 */
export async function getSmartContext(username: string, taskId: string): Promise<SmartContext> {
  const task = await getTaskMeta(username, taskId);
  if (!task) throw new Error(`未找到任务：${taskId}`);

  const directSpecs: ParsedSpec[] = [];
  const groupSet = new Set<string>();

  // 收集直接关联项目的 spec
  if (task.projects?.length) {
    const specArrays = await Promise.all(
      task.projects.map((pid) => getProjectSpecs(username, pid)),
    );
    directSpecs.push(...specArrays.flat());

    for (const pid of task.projects) {
      const meta = await getProjectMeta(username, pid);
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

  return {
    task,
    directSpecs,
    relatedSpecs,
    semanticSpecs: [], // P2 阶段通过 RAG 填充
  };
}

/** 将上下文格式化为 Markdown 输出 */
export function formatContextAsMarkdown(ctx: ProjectContext): string {
  const lines: string[] = [];

  lines.push('# 项目上下文\n');

  if (ctx.cascadedSpecs.length > 0) {
    lines.push('## 规范（Spec）\n');
    for (const spec of ctx.cascadedSpecs) {
      const title = spec.frontmatter.title ?? spec.fileName.replace('.md', '');
      lines.push(`### ${title}\n`);
      lines.push(spec.content);
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
  }

  return lines.join('\n');
}
