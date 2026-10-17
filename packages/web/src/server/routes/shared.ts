import type { FastifyInstance } from 'fastify';
import { sep } from 'node:path';
import { getLatticeRoot, type ParsedSpec } from '@qcqx/lattice-core';
import type { getUsername as GetUsername } from '@qcqx/lattice-core';
import * as lattice from '@qcqx/lattice-services';

/** 验证路径安全：只允许 ~/.lattice 下或已注册项目路径 */
export async function isPathSafe(path: string, username: string): Promise<boolean> {
  const latticeRoot = getLatticeRoot();
  if (path === latticeRoot || path.startsWith(latticeRoot + sep)) return true;
  try {
    const projects = await lattice.listProjects(username);
    return projects.some((p) => {
      const localPaths = p.localPaths || [];
      return localPaths.some((lp: string) => path === lp || path.startsWith(lp + sep));
    });
  } catch {
    return false;
  }
}

/**
 * 根据 type + entityId 安全解析文件路径（委托 services，多宿主一致）。
 * 不接受前端直接传路径，而是通过 type + entityId 在后端解析。
 */
export async function resolveFilePath(
  type: string,
  entityId: string,
  username: string,
): Promise<string | null> {
  return lattice.resolveContentPath(username, type, entityId);
}

// ParsedSpec 仅用于类型再导出（保持既有引用兼容）
export type { ParsedSpec };

/** 获取当前用户名的快捷引用（避免循环依赖） */
export type GetUsernameFn = typeof GetUsername;

/** 路由模块注册函数类型 */
export type RouteRegistrar = (app: FastifyInstance) => void | Promise<void>;

/** 域镜像文件读取：仅允许 .sync-domains 内的绝对路径（防任意文件读取） */
export async function readDomainMirrorFile(absolutePath: string): Promise<string | null> {
  const { getSyncDomainsDir } = await import('@qcqx/lattice-core');
  const root = getSyncDomainsDir();
  if (!absolutePath.startsWith(root + sep)) return null;
  const { readFile } = await import('node:fs/promises');
  return readFile(absolutePath, 'utf-8').catch(() => null);
}

/** 域任务文档：taskId 本地 miss 时从镜像读取（prd.md / design.md / progress.yaml） */
export async function readDomainTaskDoc(
  username: string,
  taskId: string,
  file: string,
): Promise<string | null> {
  const { createComposite, getSyncDomainsDir } = await import('@qcqx/lattice-core');
  const composite = await createComposite(username);
  const view = await composite.knowledgeView();
  const dt = view.tasks.find((v) => v.task.id === taskId && v.source !== 'local');
  if (!dt || !dt.username) return null;
  const { join } = await import('node:path');
  return readDomainMirrorFile(
    join(getSyncDomainsDir(), dt.source, 'users', dt.username, 'tasks', taskId, file),
  );
}
