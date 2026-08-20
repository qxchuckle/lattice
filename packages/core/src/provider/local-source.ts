import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import type { ProjectMeta } from '../types';
import { getUserSpecs, getGlobalSpecs } from '../spec';
import { parseSpec } from '../spec/io';
import { listTasks } from '../task';
import { listProjectMetas, normalizeProjectMeta } from '../project';
import { listUserDirs, readJSON, getUserProjectsDir, getUserSpecDir } from '../paths';
import { deriveContractId } from '../sync/contribution';
import type { DataSource, SpecView, TaskView, ProjectView } from './types';

/**
 * LocalSource：包装既有读函数（语义不变），主数据唯一可写源。
 * 遮蔽与合并只发生在 CompositeProvider；本源不感知域的存在。
 * 项目级 spec 采用纯磁盘枚举（不经 getProjectSpecs 的 DB 虚拟合并路径），
 * 保证与 DomainSource 对称且不依赖 DB 初始化状态。
 */
export function createLocalSource(username: string): DataSource {
  return {
    id: 'local',
    kind: 'local',
    use: 'trusted',

    async listSpecs(): Promise<SpecView[]> {
      const out: SpecView[] = [];

      // 全局级
      for (const s of await getGlobalSpecs()) {
        out.push({
          spec: s,
          source: 'local',
          scope: 'global',
          namespace: `global:${s.relativePath}`,
        });
      }

      for (const u of await listUserDirs()) {
        // 用户级
        for (const s of await getUserSpecs(u)) {
          out.push({
            spec: s,
            source: 'local',
            scope: 'user',
            username: u,
            namespace: `user:${u}:${s.relativePath}`,
          });
        }

        // 项目级：磁盘枚举各项目目录 spec/，契约 ID 由 project.json ids 推导
        const projectsDir = getUserProjectsDir(u);
        const dirNames = (await readdir(projectsDir).catch(() => [] as string[])).filter(
          (n) => !n.startsWith('.'),
        );
        for (const dirName of dirNames) {
          const meta = await readJSON<ProjectMeta>(join(projectsDir, dirName, 'project.json'));
          if (!meta) continue;
          const normalized = normalizeProjectMeta(meta);
          const contractId = deriveContractId(normalized.ids ?? []);
          const nsKey = contractId ?? dirName;
          const specDir = join(projectsDir, dirName, 'spec');
          for (const rel of await walkLocalMarkdown(specDir)) {
            const spec = await parseSpec(join(specDir, rel), rel);
            if (spec) {
              out.push({
                spec,
                source: 'local',
                scope: 'project',
                username: u,
                contractId: contractId ?? undefined,
                namespace: `project:${u}:${nsKey}:${rel}`,
              });
            }
          }
        }
      }
      void username;
      void getUserSpecDir;
      return out;
    },

    async listTasks(): Promise<TaskView[]> {
      const out: TaskView[] = [];
      for (const u of await listUserDirs()) {
        for (const t of await listTasks(u)) {
          out.push({ task: t, source: 'local', username: u });
        }
      }
      return out;
    },

    async listProjects(): Promise<ProjectView[]> {
      const out: ProjectView[] = [];
      for (const u of await listUserDirs()) {
        for (const p of await listProjectMetas(u)) {
          out.push({
            project: p,
            source: 'local',
            username: u,
            contractId: deriveContractId(p.ids ?? []),
          });
        }
      }
      return out;
    },
  };
}

/** 递归收集目录下 .md 相对路径（POSIX，跳过点开头条目） */
async function walkLocalMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      for (const rel of await walkLocalMarkdown(full)) out.push(`${e.name}/${rel}`);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(e.name);
    }
  }
  return out;
}
