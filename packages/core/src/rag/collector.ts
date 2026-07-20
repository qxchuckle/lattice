import type { SearchDocumentType } from '../types';
import { listUserDirs } from '../paths';
import { getGlobalSpecs, getUserSpecs, getProjectSpecs } from '../spec';
import { listTasks, getTaskPrd, getTaskDesign } from '../task';
import { readProgress } from '../task/checkpoint';
import { listProjects, getAllUniqueRelations } from '../project';
import { readProfileSummary, readProfileTags } from '../project/profile';
import { getProjectProfileSummaryPath } from '../paths';

export interface SearchDocumentInput {
  filePath: string;
  content: string;
  title: string;
  tags?: string[];
  username: string;
  sourceType?: SearchDocumentType;
  projectId?: string;
  projectIds?: string[];
}

/** spec 文件的最小结构契约（getGlobalSpecs/getUserSpecs/getProjectSpecs 返回元素） */
interface SpecFileLike {
  filePath: string;
  content: string;
  fileName: string;
  frontmatter: { title?: string; tags?: string[] };
}

/** 构建 spec 类型的搜索文档（消除全局/用户/项目级 spec 构建重复） */
function buildSpecDoc(s: SpecFileLike, username: string, projectId?: string): SearchDocumentInput {
  return {
    filePath: s.filePath,
    content: s.content,
    title: s.frontmatter.title ?? s.fileName,
    tags: s.frontmatter.tags,
    username,
    sourceType: 'spec',
    projectId,
    projectIds: projectId ? [projectId] : undefined,
  };
}

/** 收集所有待索引的搜索文档（spec + task + project + relation） */
export async function collectAllSearchDocuments(): Promise<SearchDocumentInput[]> {
  const allDocs: SearchDocumentInput[] = [];

  // 全局 spec
  const globalSpecs = await getGlobalSpecs();
  for (const s of globalSpecs) {
    allDocs.push(buildSpecDoc(s, ''));
  }

  const usernames = await listUserDirs();
  // 各用户并发收集（同步 DB 操作串行执行，文件 I/O 并发）
  const userDocsArrays = await Promise.all(usernames.map((u) => collectUserDocs(u)));
  for (const docs of userDocsArrays) {
    allDocs.push(...docs);
  }

  return allDocs;
}

/** 收集单个用户的所有搜索文档 */
async function collectUserDocs(username: string): Promise<SearchDocumentInput[]> {
  const docs: SearchDocumentInput[] = [];

  // 用户级 spec
  const userSpecs = await getUserSpecs(username);
  for (const s of userSpecs) {
    docs.push(buildSpecDoc(s, username));
  }

  // 项目级 spec（并发读取各项目，getProjectSpecs 内部已聚合虚拟合并组，需按 filePath 去重）
  const projects = listProjects(username);
  const seenSpecPaths = new Set<string>();
  const projectSpecResults = await Promise.all(
    projects.map(async (project) => ({
      project,
      specs: await getProjectSpecs(username, project.id),
    })),
  );
  for (const { project, specs } of projectSpecResults) {
    for (const s of specs) {
      if (seenSpecPaths.has(s.filePath)) continue;
      seenSpecPaths.add(s.filePath);
      docs.push(buildSpecDoc(s, username, project.id));
    }
  }

  // 任务：一次遍历，PRD + checkpoint + design 并发读取（3 个独立文件 I/O）
  const tasks = await listTasks(username);
  for (const task of tasks) {
    const [prd, progress, design] = await Promise.all([
      getTaskPrd(username, task.id),
      readProgress(username, task.id),
      getTaskDesign(username, task.id),
    ]);

    // PRD 文档
    const prdContent = [
      `任务标题：${task.title}`,
      `任务状态：${task.status}`,
      task.projects?.length ? `关联项目：${task.projects.join(', ')}` : '',
      prd ?? '',
    ]
      .filter(Boolean)
      .join('\n\n');
    docs.push({
      filePath: `user/${username}/task/${task.id}/prd.md`,
      content: prdContent,
      title: task.title,
      tags: ['task', task.status],
      username,
      sourceType: 'task',
      projectIds: task.projects,
    });

    // checkpoint 文档（逐条索引）
    for (const entry of progress.entries) {
      const cpContent = [`任务：${task.title}`, `类型：${entry.type}`, entry.title, entry.message]
        .filter(Boolean)
        .join('\n\n');
      docs.push({
        filePath: `user/${username}/task/${task.id}/checkpoint/${entry.id}`,
        content: cpContent,
        title: `[${entry.type}] ${entry.title}`,
        tags: ['checkpoint', entry.type, task.status],
        username,
        sourceType: 'checkpoint',
        projectIds: task.projects,
      });
    }

    // design 文档
    if (design) {
      const designContent = [`任务：${task.title}`, design].filter(Boolean).join('\n\n');
      docs.push({
        filePath: `user/${username}/task/${task.id}/design.md`,
        content: designContent,
        title: `[design] ${task.title}`,
        tags: ['design', task.status],
        username,
        sourceType: 'design',
        projectIds: task.projects,
      });
    }
  }

  // 项目本身
  for (const project of projects) {
    const tags: string[] = project.tags ? JSON.parse(project.tags) : [];
    const groups: string[] = project.groups ? JSON.parse(project.groups) : [];
    const localPaths = parseJsonArray(project.local_path);
    const gitRemotes = parseJsonArray(project.git_remote);
    const packageNames = parseJsonArray(project.package_names);
    const monorepoPackages = parseJsonArray(project.monorepo_packages);
    const projectContent = [
      `项目名称：${project.name}`,
      `项目 ID：${project.id}`,
      project.description ? `项目描述：${project.description}` : '',
      gitRemotes.length > 0 ? `Git 仓库：${gitRemotes.join(', ')}` : '',
      groups.length > 0 ? `分组：${groups.join(', ')}` : '',
      tags.length > 0 ? `标签：${tags.join(', ')}` : '',
      packageNames.length > 0 ? `包名：${packageNames.join(', ')}` : '',
      monorepoPackages.length > 0 ? `monorepo 包：${monorepoPackages.join(', ')}` : '',
      localPaths.length > 0 ? `本地路径：${localPaths.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    docs.push({
      filePath: `user/${username}/project/${project.id}/project.md`,
      content: projectContent,
      title: project.name,
      tags: ['project', ...tags, ...groups],
      username,
      sourceType: 'project',
      projectId: project.id,
      projectIds: [project.id],
    });
  }

  // 项目画像（profile/summary.md）
  for (const project of projects) {
    const summary = await readProfileSummary(username, project.id);
    if (summary) {
      const tags = await readProfileTags(username, project.id);
      docs.push({
        filePath: getProjectProfileSummaryPath(username, project.id),
        content: summary,
        title: `${project.name} — 项目画像`,
        tags: ['project-profile', ...tags],
        username,
        sourceType: 'project' as SearchDocumentType,
        projectId: project.id,
        projectIds: [project.id],
      });
    }
  }

  // 项目关联关系
  const relations = await getAllUniqueRelations(username);
  for (const rel of relations) {
    const projectA = projects.find((p) => p.id === rel.project_a);
    const projectB = projects.find((p) => p.id === rel.project_b);
    const nameA = projectA?.name ?? rel.project_a;
    const nameB = projectB?.name ?? rel.project_b;
    const relationContent = [
      `${nameA} ↔ ${nameB}`,
      `关系类型：${rel.relation_type}`,
      rel.description ? `描述：${rel.description}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    docs.push({
      filePath: `user/${username}/relation/${rel.id}`,
      content: relationContent,
      title: `${nameA} ↔ ${nameB}`,
      tags: ['relation', rel.relation_type],
      username,
      sourceType: 'relation',
      projectIds: [rel.project_a, rel.project_b],
    });
  }

  return docs;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
