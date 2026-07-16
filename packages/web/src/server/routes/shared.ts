import type { FastifyInstance } from 'fastify';
import { sep } from 'node:path';
import { getLatticeRoot, listVirtualProjectMetas } from '@qcqx/lattice-core';
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

/** 获取当前用户名的快捷引用（避免循环依赖） */
export type GetUsernameFn = typeof GetUsername;

/** 路由模块注册函数类型 */
export type RouteRegistrar = (app: FastifyInstance) => void | Promise<void>;
