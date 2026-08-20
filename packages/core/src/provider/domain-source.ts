import { join, relative } from 'node:path';
import { readdir, access } from 'node:fs/promises';
import type { TaskMeta, ProjectMeta } from '../types';
import { parseSpec } from '../spec/io';
import { readJSON } from '../paths';
import { normalizeProjectMeta } from '../project';
import { decodeContractDirName, deriveContractId } from '../sync/contribution';
import { isRebaseInProgress } from '../sync/mirror';
import type { DataSource, SpecView, TaskView, ProjectView, DomainSourceInput } from './types';

/**
 * DomainSource：读取单个域镜像（.sync-domains/<hash>），纯文件系统枚举。
 *
 * G1 源故障隔离：枚举异常向上抛 DegradedSourceError，由 CompositeProvider
 *   捕获降级（跳过该域 + 警告），绝不炸掉整体命令。
 * G2 并发脏读防护：镜像处于 rebase 中间态（sync 进行中）→ 本源本轮不可读。
 */
export class DegradedSourceError extends Error {
  constructor(
    public readonly domainHash: string,
    reason: string,
  ) {
    super(`域 ${domainHash} 本轮不可读：${reason}`);
    this.name = 'DegradedSourceError';
  }
}

export function createDomainSource(input: DomainSourceInput): DataSource {
  const { domainHash, mirrorDir } = input;
  const use = input.domain.use ?? 'trusted';

  async function assertReadable(): Promise<void> {
    if (await isRebaseInProgress(mirrorDir)) {
      throw new DegradedSourceError(domainHash, '同步进行中（rebase 中间态），读取跳过');
    }
    // 镜像目录缺失（手删/G4 场景）：配置在但无数据可读，本轮降级
    try {
      await access(mirrorDir);
    } catch {
      throw new DegradedSourceError(domainHash, '镜像目录缺失，请重新 join 或 ltc sync 拉取');
    }
  }

  async function listMirrorUserDirs(): Promise<string[]> {
    const entries = await readdir(join(mirrorDir, 'users')).catch(() => [] as string[]);
    return entries.filter((n) => !n.startsWith('.'));
  }

  return {
    id: domainHash,
    kind: 'domain',
    use,
    mirrorDir,

    async listSpecs(): Promise<SpecView[]> {
      await assertReadable();
      const out: SpecView[] = [];

      // 全局级：镜像 spec/
      const globalDir = join(mirrorDir, 'spec');
      for (const rel of await walkMarkdown(globalDir)) {
        const spec = await parseSpec(join(globalDir, rel), rel);
        if (spec) {
          out.push({ spec, source: domainHash, scope: 'global', namespace: `global:${rel}` });
        }
      }

      // 用户级 + 项目级
      for (const u of await listMirrorUserDirs()) {
        const userSpecDir = join(mirrorDir, 'users', u, 'spec');
        for (const rel of await walkMarkdown(userSpecDir)) {
          const spec = await parseSpec(join(userSpecDir, rel), rel);
          if (spec) {
            out.push({
              spec,
              source: domainHash,
              scope: 'user',
              username: u,
              namespace: `user:${u}:${rel}`,
            });
          }
        }

        const projectsDir = join(mirrorDir, 'users', u, 'projects');
        const projectDirs = (await readdir(projectsDir).catch(() => [] as string[])).filter(
          (n) => !n.startsWith('.'),
        );
        for (const dirName of projectDirs) {
          const contractId = decodeContractDirName(dirName);
          const specDir = join(projectsDir, dirName, 'spec');
          for (const rel of await walkMarkdown(specDir)) {
            const spec = await parseSpec(join(specDir, rel), rel);
            if (spec) {
              out.push({
                spec,
                source: domainHash,
                scope: 'project',
                username: u,
                contractId,
                namespace: `project:${u}:${contractId}:${rel}`,
              });
            }
          }
        }
      }
      return out;
    },

    async listTasks(): Promise<TaskView[]> {
      await assertReadable();
      const out: TaskView[] = [];
      for (const u of await listMirrorUserDirs()) {
        const tasksDir = join(mirrorDir, 'users', u, 'tasks');
        const taskDirs = (await readdir(tasksDir).catch(() => [] as string[])).filter(
          (n) => !n.startsWith('.'),
        );
        for (const tid of taskDirs) {
          const meta = await readJSON<TaskMeta>(join(tasksDir, tid, 'task.json'));
          if (meta) out.push({ task: meta, source: domainHash, username: u });
        }
      }
      return out;
    },

    async listProjects(): Promise<ProjectView[]> {
      await assertReadable();
      const out: ProjectView[] = [];
      for (const u of await listMirrorUserDirs()) {
        const projectsDir = join(mirrorDir, 'users', u, 'projects');
        const projectDirs = (await readdir(projectsDir).catch(() => [] as string[])).filter(
          (n) => !n.startsWith('.'),
        );
        for (const dirName of projectDirs) {
          const raw = await readJSON<ProjectMeta>(join(projectsDir, dirName, 'project.json'));
          if (!raw) continue;
          const meta = normalizeProjectMeta(raw);
          out.push({
            project: meta,
            source: domainHash,
            username: u,
            contractId: deriveContractId(meta.ids ?? []),
          });
        }
      }
      return out;
    },
  };
}

/** 递归收集目录下 .md 文件相对路径（POSIX 风格，跳过点开头条目） */
async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      for (const rel of await walkMarkdown(full)) out.push(`${e.name}/${rel}`);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(relative(dir, full).split('\\').join('/'));
    }
  }
  return out;
}
