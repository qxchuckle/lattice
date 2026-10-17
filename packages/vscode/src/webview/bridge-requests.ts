/**
 * Bridge 请求处理：webview → 扩展宿主的数据面。
 *
 * 分层：本模块是 `@qcqx/lattice-services`（多宿主共享用例）的 postMessage 绑定，
 * 只保留三件事：JSON 载荷装配、快照缓存读取、协议错误码。
 * 刻意不 import vscode —— 可被 Node 侧冒烟 harness 复用（webview/src/smoke）。
 */
import { homedir } from 'node:os';
import * as path from 'node:path';
import {
  currentUsername,
  findSpec,
  getProjectDetail,
  getProjectGitStatus,
  getTaskContext,
  getTaskDetail,
  inferSpecScope,
  readContent,
  resolveContentPath,
  search as searchService,
} from '@qcqx/lattice-services';
import type { ParsedSpec } from '@qcqx/lattice-core';
import type {
  BridgeRequestMethod,
  ContentParams,
  SearchBridgeParams,
  SnapshotSpec,
  SpecScopeWire,
} from '@qcqx/lattice-protocol';
import { CliError } from '../cli/errors';
import type { SpecRow } from '../cli/types';
import type { SnapshotStore } from '../state/snapshot';

/** 请求处理器依赖端口（宿主注入；Node 侧无需 vscode）。 */
export interface BridgeRequestServices {
  /** 宿主侧快照缓存（图谱全量 + 视图行模型）。 */
  snapshot: SnapshotStore;
  /** 作用域化用户名（只读浏览时返回被浏览用户；缺省回退当前配置用户）。 */
  username?: () => Promise<string>;
}

/** 快照行（视图行模型）→ 协议 spec 行。 */
export function specRowToSnapshotSpec(row: SpecRow): SnapshotSpec {
  const fileName = row.filePath ? (row.filePath.split('/').pop() ?? row.id) : row.id;
  const tags = Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === 'string') : [];
  return {
    id: row.id || fileName,
    title: row.title || fileName,
    description: row.description ?? undefined,
    tags,
    filePath: row.filePath,
    fileName,
    relativePath: '',
    content: '',
    scope: row.scope,
    projectId: row.projectId,
    updated: row.updated,
    frontmatter: {
      id: row.id || fileName,
      title: row.title || fileName,
      tags,
      description: row.description ?? undefined,
      updated: row.updated,
    },
  };
}

/** core ParsedSpec → 协议 spec 行（content 留空：详情面板按需经 getContent 拉取）。 */
export function parsedSpecToSnapshotSpec(
  spec: ParsedSpec,
  scope: SpecScopeWire,
  projectId?: string,
): SnapshotSpec {
  const id = spec.frontmatter.id ?? spec.fileName;
  const title = spec.frontmatter.title ?? spec.fileName;
  const tags = (spec.frontmatter.tags ?? []).filter((tag) => typeof tag === 'string');
  return {
    id,
    title,
    description: spec.frontmatter.description ?? undefined,
    tags,
    filePath: spec.filePath,
    fileName: spec.fileName,
    relativePath: spec.relativePath,
    content: '',
    scope,
    projectId,
    updated: spec.frontmatter.updated,
    frontmatter: {
      id,
      title,
      tags,
      description: spec.frontmatter.description,
      updated: spec.frontmatter.updated,
    },
  };
}

export async function handleBridgeRequest(
  services: BridgeRequestServices,
  method: BridgeRequestMethod,
  params: unknown,
): Promise<unknown> {
  await services.snapshot.ensure(['user', 'projects', 'tasks', 'specs']);
  const username = () => services.username?.() ?? currentUsername();
  switch (method) {
    case 'getSnapshot': {
      const state = services.snapshot.data;
      return {
        username: state.username ?? '',
        // ids：优先完整的 core 多 ID 集合（虚拟合并），缺失时退回最低可用集合（web 侧同样有防御回退）
        projects: state.projects.map((project) => ({
          ...project,
          ids:
            project.ids && project.ids.length > 0
              ? project.ids
              : [project.id, project.id.split(':').pop() ?? project.id].filter(
                  (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
                ),
        })),
        tasks: state.tasks,
        specs: services.snapshot.allSpecs.map(specRowToSnapshotSpec),
        relations: state.relations,
      };
    }
    case 'getTaskDetail': {
      const { id } = params as { id: string };
      return getTaskDetail(await username(), id);
    }
    case 'getProjectDetail': {
      const { id } = params as { id: string };
      const detail = await getProjectDetail(await username(), id);
      return {
        project: detail.project,
        specs: detail.specs.map((entry) =>
          parsedSpecToSnapshotSpec(entry.spec, entry.scope, entry.projectId),
        ),
        tasks: detail.tasks,
        relations: detail.relations,
      };
    }
    case 'getProjectGitStatus': {
      const { id } = params as { id: string };
      return getProjectGitStatus(await username(), id);
    }
    case 'getSpecDetail': {
      const { id } = params as { id: string };
      const fromSnapshot = services.snapshot.specById(id);
      if (fromSnapshot) return { spec: specRowToSnapshotSpec(fromSnapshot) };
      const found = await findSpec(await username(), id).catch(() => null);
      return {
        spec: found ? parsedSpecToSnapshotSpec(found.spec, found.scope, found.projectId) : null,
      };
    }
    case 'getTaskContext': {
      const { id } = params as { id: string };
      try {
        const context = await getTaskContext(await username(), id);
        const map = (specs: ParsedSpec[]): SnapshotSpec[] =>
          specs.map((spec) =>
            parsedSpecToSnapshotSpec(
              spec,
              inferSpecScope(spec.filePath, services.snapshot.data.username ?? ''),
              spec.projectId,
            ),
          );
        return {
          directSpecs: map(context.directSpecs),
          relatedSpecs: map(context.relatedSpecs),
          semanticSpecs: map(context.semanticSpecs),
        };
      } catch {
        return { directSpecs: [], relatedSpecs: [], semanticSpecs: [] };
      }
    }
    case 'getContent': {
      const { type, id } = params as ContentParams;
      return { content: await readContent(await username(), type, id) };
    }
    case 'getGlobalStatus':
      return { home: homedir(), pathSep: path.sep };
    case 'getPath': {
      const { pathType, entityId } = params as { pathType: string; entityId: string };
      return { path: await resolveContentPath(await username(), pathType, entityId) };
    }
    case 'search': {
      const { query, type, limit, projectId } = params as SearchBridgeParams;
      return searchService(await username(), query, {
        types: type ? [type] : undefined,
        limit,
        projectId,
      });
    }
    case 'getStats': {
      const state = services.snapshot.data;
      return {
        projectCount: state.projects.length,
        taskCount: state.tasks.length,
        activeTaskCount: state.tasks.filter((task) => task.status === 'in_progress').length,
        relationCount: state.relations.length,
      };
    }
    case 'getDomainsData':
      return { domains: [], degraded: [], specs: [], tasks: [], projects: [] };
    default:
      throw new CliError('CLI_PARSE', `Unknown bridge method: ${String(method)}`);
  }
}
