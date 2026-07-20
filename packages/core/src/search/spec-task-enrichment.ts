import type { SearchResult, ReferencedSpec } from '../types';
import { hybridSearch } from './search';
import { getTaskMeta } from '../task';
import { findUsernameAndDirName } from '../project/lookup';
import { getGlobalSpecDir, getUserSpecDir, getProjectSpecDir, join, fileExists } from '../paths';
import { parseSpec } from '../spec/io';

/** 任务反查 spec 的固定分数（低于正常搜索命中） */
const TASK_REF_SPEC_SCORE = 0.08;
/** 任务搜索上限（hybridSearch 内部有 MIN_FINAL_SCORE 质量门控，此处放宽以聚合所有相关任务） */
const TASK_SEARCH_LIMIT = 50;

interface TaskRefSpecEntry {
  ref: ReferencedSpec;
  taskId: string;
  taskTitle: string;
  taskFilePath: string;
  taskProjectIds: string[];
  username: string;
}

/**
 * 搜索 spec 时，额外搜索任务并反查其 referencedSpecs。
 *
 * 对于相关任务引用的 spec：
 * - 已在主搜索结果中的：追加 matchedVia 标注
 * - 不在主结果中的：作为额外结果追加（较低分 + matchedVia 标注）
 */
export async function enrichSpecResultsWithTaskRefs(
  results: SearchResult[],
  query: string,
  opts?: {
    projectId?: string;
    usernames?: string[];
  },
): Promise<SearchResult[]> {
  // 搜索相关任务
  let taskResults: SearchResult[];
  try {
    taskResults = await hybridSearch(query, {
      type: 'task',
      limit: TASK_SEARCH_LIMIT,
      projectId: opts?.projectId,
      usernames: opts?.usernames,
    });
  } catch {
    return results;
  }

  if (taskResults.length === 0) return results;

  // 收集所有任务的 referencedSpecs
  const refSpecEntries: TaskRefSpecEntry[] = [];

  for (const tr of taskResults) {
    const meta = tr.meta as Record<string, unknown>;
    const taskId = (meta.taskId as string) || '';
    const username = (meta.username as string) || '';
    if (!taskId || !username) continue;

    const taskMeta = await getTaskMeta(username, taskId);
    if (!taskMeta?.referencedSpecs?.length) continue;

    for (const ref of taskMeta.referencedSpecs) {
      refSpecEntries.push({
        ref,
        taskId,
        taskTitle: taskMeta.title,
        taskFilePath: (meta.filePath as string) || '',
        taskProjectIds: taskMeta.projects ?? [],
        username,
      });
    }
  }

  if (refSpecEntries.length === 0) return results;

  // 按 spec id 聚合：同一 spec 可能被多个任务引用，收集所有来源任务
  const specAggregation = new Map<
    string,
    {
      entry: TaskRefSpecEntry;
      tasks: { taskId: string; taskTitle: string; taskFilePath: string }[];
    }
  >();
  for (const entry of refSpecEntries) {
    const key = entry.ref.id;
    const existing = specAggregation.get(key);
    if (existing) {
      // 去重追加任务
      if (!existing.tasks.some((t) => t.taskId === entry.taskId)) {
        existing.tasks.push({
          taskId: entry.taskId,
          taskTitle: entry.taskTitle,
          taskFilePath: entry.taskFilePath,
        });
      }
    } else {
      specAggregation.set(key, {
        entry,
        tasks: [
          { taskId: entry.taskId, taskTitle: entry.taskTitle, taskFilePath: entry.taskFilePath },
        ],
      });
    }
  }

  // 已有结果的 filePath 集合（用于去重）
  const existingPaths = new Set(
    results.map((r) => ((r.meta as Record<string, unknown>).filePath as string) || ''),
  );

  const enriched = [...results];
  const addedPaths = new Set<string>();

  for (const { entry, tasks } of specAggregation.values()) {
    const specPath = await resolveRefSpecPath(entry);
    if (!specPath) continue;

    // matchedVia 携带所有引用该 spec 的相关任务
    const matchedVia = {
      docType: 'task' as const,
      docTitle: tasks.map((t) => t.taskTitle).join('、'),
      docPath: tasks[0].taskFilePath,
      taskId: tasks[0].taskId,
      tasks: tasks.length > 1 ? tasks : undefined,
    };

    // 检查是否已在主搜索结果中
    const existingResult = enriched.find(
      (r) => ((r.meta as Record<string, unknown>).filePath as string) === specPath,
    );

    if (existingResult) {
      // 已存在：追加 matchedVia 标注（不覆盖已有 matchedVia）
      const meta = existingResult.meta as Record<string, unknown>;
      if (!meta.matchedVia) {
        meta.matchedVia = matchedVia;
      }
      continue;
    }

    // 避免重复添加
    if (addedPaths.has(specPath) || existingPaths.has(specPath)) continue;

    // 读取 spec 文件获取 title
    const spec = await parseSpec(specPath, entry.ref.relativePath);
    if (!spec) continue;

    const taskNames = tasks.map((t) => `「${t.taskTitle}」`).join('、');
    addedPaths.add(specPath);
    enriched.push({
      type: 'spec',
      score: TASK_REF_SPEC_SCORE,
      title: spec.frontmatter.title ?? spec.fileName,
      snippet: `通过任务${taskNames}关联发现`,
      meta: {
        filePath: specPath,
        source: 'task-ref',
        username: entry.username,
        projectIds: entry.taskProjectIds,
        matchedVia,
      },
    });
  }

  return enriched;
}

/**
 * 根据 ReferencedSpec 的 scope + relativePath 解析绝对文件路径。
 *
 * - global → getGlobalSpecDir() + relativePath
 * - user → getUserSpecDir(username) + relativePath
 * - project → 遍历任务关联项目，找到存在的文件
 */
async function resolveRefSpecPath(entry: TaskRefSpecEntry): Promise<string | null> {
  const { ref, username, taskProjectIds } = entry;

  if (ref.scope === 'global') {
    const p = join(getGlobalSpecDir(), ref.relativePath);
    return (await fileExists(p)) ? p : null;
  }

  if (ref.scope === 'user') {
    const p = join(getUserSpecDir(username), ref.relativePath);
    return (await fileExists(p)) ? p : null;
  }

  // project scope：遍历任务关联的项目，找到包含该 spec 的项目目录
  for (const projectId of taskProjectIds) {
    const found = await findUsernameAndDirName(projectId);
    if (!found) continue;
    const p = join(getProjectSpecDir(found.username, found.dirName), ref.relativePath);
    if (await fileExists(p)) return p;
  }

  return null;
}
