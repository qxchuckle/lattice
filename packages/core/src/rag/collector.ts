import type { SearchDocumentType } from '../types';
import { listUserDirs, readText, join } from '../paths';
import { getGlobalSpecs, getUserSpecs, getProjectSpecs } from '../spec';
import { listTasks, getTaskPrd, getTaskDesign } from '../task';
import { readProgress } from '../task/checkpoint';
import { listProjects, getAllUniqueRelations } from '../project';
import { readProfileSummary, readProfileTags } from '../project/profile';
import { getProjectProfileSummaryPath } from '../paths';
import { createComposite } from '../provider/composite';
import { parse as parseYaml } from 'yaml';

export interface SearchDocumentInput {
  filePath: string;
  content: string;
  title: string;
  tags?: string[];
  username: string;
  sourceType?: SearchDocumentType;
  projectId?: string;
  projectIds?: string[];
  /** 数据来源：'local'（主数据，默认）或域 hash（D20；域文档用镜像绝对路径，孤儿清理按路径生效） */
  source?: string;
}

/** spec 文件的最小结构契约（getGlobalSpecs/getUserSpecs/getProjectSpecs 返回元素） */
interface SpecFileLike {
  filePath: string;
  content: string;
  fileName: string;
  frontmatter: { title?: string; tags?: string[] };
}

/** 构建 spec 类型的搜索文档（消除全局/用户/项目级 spec 构建重复） */
function buildSpecDoc(
  s: SpecFileLike,
  username: string,
  projectId?: string,
  source?: string,
): SearchDocumentInput {
  return {
    filePath: s.filePath,
    content: s.content,
    title: s.frontmatter.title ?? s.fileName,
    tags: s.frontmatter.tags,
    username,
    sourceType: 'spec',
    projectId,
    projectIds: projectId ? [projectId] : undefined,
    source,
  };
}

/**
 * 域镜像 progress.yaml 安全解析（容错：坏文件返回空）。
 * 复用主数据 ProgressFile 结构，但不绑定主数据路径。
 */
function safeParseProgress(
  raw: string,
): Array<{ id: string; type: string; title: string; message: string }> {
  try {
    const data = parseYaml(raw) as {
      entries?: Array<{ id: string; type: string; title: string; message: string }>;
    } | null;
    return data?.entries ?? [];
  } catch {
    return [];
  }
}

/**
 * 域文档收集（v3）：从 knowledgeView 拿遥蔽去重后的胜者条目。
 *
 * - 域 spec：胜者才索引，被遥蔽副本永不索引（collector 不理解遥蔽）；
 * - 域任务：PRD + design（v1；checkpoint 逐条索引 v2）；
 * - 域项目：元数据文档（name/tags/ids）；
 * - 域 source/off 档不进 knowledgeView，自然不索引；
 * - G1 降级域自动跳过（镜像缺失/同步中）。
 */
async function collectDomainDocs(currentUsername: string): Promise<SearchDocumentInput[]> {
  const composite = await createComposite(currentUsername);
  const view = await composite.knowledgeView();
  const docs: SearchDocumentInput[] = [];

  // 域 spec（含本地胜出的路径——本地已索引，只补 source!==local 的胜者）
  for (const v of view.specs) {
    if (v.source === 'local') continue;
    docs.push(buildSpecDoc(v.spec, v.username ?? '', v.contractId, v.source));
  }

  // 域任务（PRD + design）与域项目元数据：直接读镜像文件
  for (const src of composite.sources) {
    if (src.kind !== 'domain' || !src.mirrorDir || src.use === 'off') continue;

    for (const v of view.tasks) {
      if (v.source !== src.id) continue;
      const taskDir = join(src.mirrorDir, 'users', v.username, 'tasks', v.task.id);
      const [prd, design, progressRaw] = await Promise.all([
        readText(join(taskDir, 'prd.md')),
        readText(join(taskDir, 'design.md')),
        readText(join(taskDir, 'progress.yaml')),
      ]);
      if (prd !== null) {
        docs.push({
          filePath: join(taskDir, 'prd.md'),
          content: [
            `任务标题：${v.task.title}`,
            `任务状态：${v.task.status}`,
            v.task.projects?.length ? `关联项目：${v.task.projects.join(', ')}` : '',
            prd,
          ]
            .filter(Boolean)
            .join('\n\n'),
          title: v.task.title,
          tags: ['task', v.task.status],
          username: v.username,
          sourceType: 'task',
          projectIds: v.task.projects,
          source: v.source,
        });
      }
      if (design) {
        docs.push({
          filePath: join(taskDir, 'design.md'),
          content: [`任务：${v.task.title}`, design].filter(Boolean).join('\n\n'),
          title: `[design] ${v.task.title}`,
          tags: ['design', v.task.status],
          username: v.username,
          sourceType: 'design',
          projectIds: v.task.projects,
          source: v.source,
        });
      }
      // checkpoint 逐条索引（与主数据 checkpoint 文档结构一致）
      if (progressRaw && progressRaw.trim()) {
        const parsed = safeParseProgress(progressRaw);
        for (const entry of parsed) {
          docs.push({
            filePath: `${join(taskDir, 'progress.yaml')}/checkpoint/${entry.id}`,
            content: [`任务：${v.task.title}`, `类型：${entry.type}`, entry.title, entry.message]
              .filter(Boolean)
              .join('\n\n'),
            title: `[${entry.type}] ${entry.title}`,
            tags: ['checkpoint', entry.type, v.task.status],
            username: v.username,
            sourceType: 'checkpoint',
            projectIds: v.task.projects,
            source: v.source,
          });
        }
      }
    }

    for (const v of view.projects) {
      if (v.source !== src.id || !v.contractId || !src.mirrorDir || !v.project.id) continue;
      // 镜像内项目目录名 = 编码契约 ID（D19），不是 primaryId
      const { encodeContractDirName } = await import('../sync/contribution');
      const mirrorDirName = encodeContractDirName(v.contractId);
      const metaPath = join(
        src.mirrorDir,
        'users',
        v.username,
        'projects',
        mirrorDirName,
        'project.json',
      );
      const metaContent = await readText(metaPath);
      if (metaContent === null) continue;
      docs.push({
        filePath: metaPath,
        content: [
          `项目：${v.project.name}`,
          `IDs：${(v.project.ids ?? []).join(', ')}`,
          v.project.description ? `描述：${v.project.description}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        title: v.project.name ?? v.contractId,
        tags: ['project'],
        username: v.username,
        sourceType: 'project',
        projectIds: [v.contractId],
        source: v.source,
      });
    }
  }
  return docs;
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

  // 域文档（v3：knowledgeView 胜者 + 域任务 PRD/design + 域项目元数据）
  const { getUsername } = await import('../config');
  const currentUsername = await getUsername().catch(() => usernames[0] ?? '');
  if (currentUsername) {
    try {
      allDocs.push(...(await collectDomainDocs(currentUsername)));
    } catch {
      // 域收集失败（配置异常等）不阻断本地索引
    }
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
