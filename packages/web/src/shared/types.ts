import type {
  ProjectMeta,
  TaskMeta,
  ProjectRelation,
  CheckpointEntry,
  ParsedSpec,
  SearchResult,
} from '@qcqx/lattice-core';

// 重新导出 core 类型供 server/client 共享
export type { ProjectMeta, TaskMeta, ProjectRelation, CheckpointEntry, ParsedSpec, SearchResult };

/** 任务查询参数 */
export interface TaskQueryParams {
  status?: string;
  projectId?: string;
  allUser?: boolean;
}

/** 搜索查询参数 */
export interface SearchParams {
  type?: string;
  projectId?: string;
  limit?: number;
}

/** 打开文件/目录请求 */
export interface OpenParams {
  path: string;
  app: 'vscode' | 'cursor' | 'qoder' | 'finder';
}

/** 全局统计 */
export interface DashboardStats {
  projectCount: number;
  taskCount: number;
  activeTaskCount: number;
  relationCount: number;
}
