import type { FastifyInstance } from 'fastify';
import { registerProjectRoutes } from './routes/projects';
import { registerTaskRoutes } from './routes/tasks';
import { registerSpecRoutes } from './routes/specs';
import { registerRagRoutes } from './routes/rag';
import { registerTaskManagementRoutes } from './routes/task-management';
import { registerProjectManagementRoutes } from './routes/project-management';
import { registerSpecManagementRoutes } from './routes/spec-management';
import { registerDoctorRoutes, registerTrashRoutes } from './routes/maintenance';
import { registerConfigRoutes } from './routes/config';
import { registerScanRoutes, registerUserRoutes } from './routes/users-scan';
import { registerGitRoutes } from './routes/git';
import { registerContentRoutes, registerStatsRoutes } from './routes/content-stats';
import { registerTerminalRoutes } from './routes/terminal';

/** 注册所有 API 路由 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // 只读查询
  registerProjectRoutes(app);
  registerTaskRoutes(app);
  registerSpecRoutes(app);
  registerStatsRoutes(app);

  // 管理操作
  registerTaskManagementRoutes(app);
  registerProjectManagementRoutes(app);
  await registerSpecManagementRoutes(app);
  registerRagRoutes(app);
  registerDoctorRoutes(app);
  registerTrashRoutes(app);
  registerConfigRoutes(app);
  registerScanRoutes(app);
  registerUserRoutes(app);
  registerGitRoutes(app);
  registerContentRoutes(app);

  // 内置终端（WebSocket）
  registerTerminalRoutes(app);
}
