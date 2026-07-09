import type { SearchDocumentType } from '../types';
import { listUserDirs } from '../paths';
import { getGlobalSpecs, getUserSpecs, getProjectSpecs } from '../spec';
import { listTasks, getTaskPrd } from '../task';
import { readProgress } from '../task/checkpoint';
import { listProjects, getAllUniqueRelations } from '../project';

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

/** 收集所有待索引的搜索文档（spec + task + project） */
export async function collectAllSearchDocuments(): Promise<SearchDocumentInput[]> {
  const allDocs: SearchDocumentInput[] = [];

  // 全局 spec
  const globalSpecs = await getGlobalSpecs();
  for (const s of globalSpecs) {
    allDocs.push({
      filePath: s.filePath,
      content: s.content,
      title: s.frontmatter.title ?? s.fileName,
      tags: s.frontmatter.tags,
      username: '',
      sourceType: 'spec',
    });
  }

  const usernames = await listUserDirs();
  for (const username of usernames) {
    // 用户级 spec
    const userSpecs = await getUserSpecs(username);
    for (const s of userSpecs) {
      allDocs.push({
        filePath: s.filePath,
        content: s.content,
        title: s.frontmatter.title ?? s.fileName,
        tags: s.frontmatter.tags,
        username,
        sourceType: 'spec',
      });
    }

    // 项目级 spec（getProjectSpecs 内部已聚合虚拟合并组，需按 filePath 去重）
    const projects = listProjects(username);
    const seenSpecPaths = new Set<string>();
    for (const project of projects) {
      const specs = await getProjectSpecs(username, project.id);
      for (const s of specs) {
        if (seenSpecPaths.has(s.filePath)) continue;
        seenSpecPaths.add(s.filePath);
        allDocs.push({
          filePath: s.filePath,
          content: s.content,
          title: s.frontmatter.title ?? s.fileName,
          tags: s.frontmatter.tags,
          username,
          sourceType: 'spec',
          projectId: project.id,
          projectIds: [project.id],
        });
      }
    }

    // 任务
    const tasks = await listTasks(username);
    for (const task of tasks) {
      const prd = (await getTaskPrd(username, task.id)) ?? '';
      const taskContent = [
        `任务标题：${task.title}`,
        `任务状态：${task.status}`,
        task.projects?.length ? `关联项目：${task.projects.join(', ')}` : '',
        prd,
      ]
        .filter(Boolean)
        .join('\n\n');
      allDocs.push({
        filePath: `user/${username}/task/${task.id}/prd.md`,
        content: taskContent,
        title: task.title,
        tags: ['task', task.status],
        username,
        sourceType: 'task',
        projectIds: task.projects,
      });
    }

    // 任务检查点（逐条索引）
    for (const task of tasks) {
      const progress = await readProgress(username, task.id);
      for (const entry of progress.entries) {
        const cpContent = [`任务：${task.title}`, `类型：${entry.type}`, entry.title, entry.message]
          .filter(Boolean)
          .join('\n\n');
        allDocs.push({
          filePath: `user/${username}/task/${task.id}/checkpoint/${entry.id}`,
          content: cpContent,
          title: `[${entry.type}] ${entry.title}`,
          tags: ['checkpoint', entry.type, task.status],
          username,
          sourceType: 'checkpoint',
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
      allDocs.push({
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
      allDocs.push({
        filePath: `user/${username}/relation/${rel.id}`,
        content: relationContent,
        title: `${nameA} ↔ ${nameB}`,
        tags: ['relation', rel.relation_type],
        username,
        sourceType: 'relation',
        projectIds: [rel.project_a, rel.project_b],
      });
    }
  }

  return allDocs;
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
