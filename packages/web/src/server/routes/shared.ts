import type { FastifyInstance } from 'fastify';
import { sep } from 'node:path';
import {
  getLatticeRoot,
  listVirtualProjectMetas,
  getTaskPrdPath,
  getTaskProgressPath,
  getTaskDesignPath,
  getProjectSpecs,
  getUserSpecs,
  getGlobalSpecs,
  type ParsedSpec,
} from '@qcqx/lattice-core';
import type { getUsername as GetUsername } from '@qcqx/lattice-core';

/** 验证路径安全：只允许 ~/.lattice 下或已注册项目路径 */
export async function isPathSafe(path: string, username: string): Promise<boolean> {
  const latticeRoot = getLatticeRoot();
  if (path === latticeRoot || path.startsWith(latticeRoot + sep)) return true;
  try {
    const projects = await listVirtualProjectMetas(username);
    return projects.some((p) => {
      const localPaths = p.localPaths || [];
      return localPaths.some((lp: string) => path === lp || path.startsWith(lp + sep));
    });
  } catch {
    return false;
  }
}

/**
 * 根据 type + entityId 安全解析文件路径。
 * 不接受前端直接传路径，而是通过 type + entityId 在后端解析。
 *
 * - prd / design / progress: entityId = taskId，通过 core 函数生成路径
 * - spec: entityId = specId（fileName 或 frontmatter.id），在各层级 specs 中查找匹配的 filePath
 */
export async function resolveFilePath(
  type: string,
  entityId: string,
  username: string,
): Promise<string | null> {
  switch (type) {
    case 'prd':
      return getTaskPrdPath(username, entityId);
    case 'design':
      return getTaskDesignPath(username, entityId);
    case 'progress':
      return getTaskProgressPath(username, entityId);
    case 'spec': {
      // 在各层级 specs 中查找匹配的 filePath
      const allSpecs: ParsedSpec[] = [
        ...(await getGlobalSpecs()),
        ...(await getUserSpecs(username)),
      ];
      // 也查项目级 specs
      const projects = await listVirtualProjectMetas(username);
      for (const p of projects) {
        if (p.id) {
          try {
            allSpecs.push(...(await getProjectSpecs(username, p.id)));
          } catch {
            // skip
          }
        }
      }
      const match = allSpecs.find(
        (s) =>
          s.fileName === entityId || s.frontmatter?.id === entityId || s.relativePath === entityId,
      );
      return match?.filePath ?? null;
    }
    default:
      return null;
  }
}

/** 获取当前用户名的快捷引用（避免循环依赖） */
export type GetUsernameFn = typeof GetUsername;

/** 路由模块注册函数类型 */
export type RouteRegistrar = (app: FastifyInstance) => void | Promise<void>;
